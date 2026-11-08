// Jawafa Forensic Guard — standalone Windows read-only auditing executable.
// No SQL driver, SQL credentials, data modification, or TrustSoft binary replacement.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace JawafaForensicGuard {
  class Program {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static int Main(string[] args) {
      try {
        if (args.Length == 0 || args[0] == "--help") {
          Console.WriteLine("JawafaForensicGuard [self-test | health [http://127.0.0.1:3456] | inventory <inventory_tables.csv> <data-folder> <output-json> <optional-comma-separated-tables>]");
          return args.Length == 0 ? 1 : 0;
        }
        if (args[0] == "self-test") return SelfTest();
        if (args[0] == "health") return Health(args.Length > 1 ? args[1] : "http://127.0.0.1:3456");
        if (args[0] == "inventory" && args.Length >= 4)
          return Inventory(args[1], args[2], args[3], args.Length > 4 ? args[4] : "dbo.CheqMovement,dbo.InvPurchaseVouchersTransactionHistory");
        throw new ArgumentException("Unsupported command; use --help.");
      } catch (Exception error) {
        Console.Error.WriteLine("AUDIT_FAILED=" + error.GetType().Name + ":" + error.Message);
        return 3;
      }
    }
    static bool AllowDbOperation(string source, string verb) {
      return String.Equals(source, "Jawafa_DB", StringComparison.OrdinalIgnoreCase)
        && String.Equals(verb, "SELECT", StringComparison.OrdinalIgnoreCase);
    }
    static int SelfTest() {
      if (AllowDbOperation("Jawafa_DB", "UPDATE") || AllowDbOperation("Jawafa_DB","DELETE")
        || AllowDbOperation("Jawafa_DB","INSERT") || AllowDbOperation("Jawafa_DB","EXEC")
        || !AllowDbOperation("Jawafa_DB","SELECT") || AllowDbOperation("OtherDb","SELECT"))
          throw new InvalidOperationException("Read-only enforcement test failed.");
      const string sample = "\"A\",\"B\"\r\n\"quoted\nline\",\"value\"\r\n\"last\",\"value\"\r\n";
      if (CountCsvRows(new StringReader(sample)) != 2)
        throw new InvalidOperationException("Quoted newline CSV parser failed.");
      Console.WriteLine("SELF_TEST_PASS read_only_gate=true csv_quoted_newline=true");
      return 0;
    }
    static int Health(string origin) {
      Uri uri = new Uri(origin);
      if (!uri.IsLoopback || uri.Scheme != "http" || uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0)
        throw new ArgumentException("Only http://127.0.0.1:<port> local bridge permitted.");
      string response = GetLocal(uri, "/api/health");
      Dictionary<string,object> data = Json.Deserialize<Dictionary<string,object>>(response);
      bool readOnly = Equals(Val(data,"mode"),"FORENSIC-READ-ONLY");
      bool correctDb = Equals(Val(data,"database"),"Jawafa_DB");
      bool privileged = Equals(Val(data,"user").ToLowerInvariant(),"sa");
      bool plain = Val(data,"passwordSource").IndexOf("plain",StringComparison.OrdinalIgnoreCase) >= 0;
      bool metadataAnonymous;
      try { metadataAnonymous = GetLocal(uri,"/api/tables").Contains("\"tables\""); }
      catch(WebException e) {
        var hr=e.Response as HttpWebResponse;
        metadataAnonymous=hr != null && ((int)hr.StatusCode>=200 && (int)hr.StatusCode<300);
      }
      bool risk = privileged || plain || metadataAnonymous || !readOnly || !correctDb;
      // Never print login details, passwords, connection strings, or source table records.
      Console.WriteLine("BRIDGE_AUDIT="+Json.Serialize(new {
        databaseVerified=correctDb,applicationReadOnlyFlag=readOnly,
        privilegedSqlAccount=privileged,plaintextPasswordStorageIndicator=plain,
        anonymousTableInventory=metadataAnonymous,criticalRisk=risk,
        note="Application flag is not proof of SQL least privilege; no SQL writes attempted."
      }));
      return risk ? 2 : 0;
    }
    static string Val(Dictionary<string,object> data,string key) {
      object value; return data.TryGetValue(key,out value) && value!=null ? value.ToString() : "";
    }
    static string GetLocal(Uri origin,string path) {
      var u = new Uri(origin,path);
      HttpWebRequest req = (HttpWebRequest)WebRequest.Create(u);
      req.Method="GET";req.Timeout=10000;req.ReadWriteTimeout=10000;req.AllowAutoRedirect=false;
      using(var res=(HttpWebResponse)req.GetResponse())
      using(var stream=new StreamReader(res.GetResponseStream(),Encoding.UTF8))
        return stream.ReadToEnd();
    }
    // Count logical CSV records, including embedded quoted newlines, without loading raw rows into memory.
    static long CountCsvRows(TextReader reader) {
      char[] buffer=new char[131072]; int n;bool quoted=false;long lines=0;char last='\0';
      while((n=reader.Read(buffer,0,buffer.Length))>0) {
        for(int i=0;i<n;i++){
          char c=buffer[i]; if(c=='"')quoted=!quoted;
          if(c=='\n'&&!quoted)lines++;
          last=c;
        }
      }
      if(last!='\n'&&last!='\0') lines++;
      if(quoted)throw new InvalidDataException("CSV has unclosed quote");
      return Math.Max(0,lines-1);
    }
    static int Inventory(string index,string folder,string destination,string targets) {
      if (!File.Exists(index) || !Directory.Exists(folder))throw new FileNotFoundException("Read-only snapshot input missing.");
      string[] lines=File.ReadAllLines(index,Encoding.UTF8);
      Regex row=new Regex("^\\\"(?<schema>[^\\\"]+)\\\",\\\"(?<name>[^\\\"]+)\\\",\\\"(?<cells>[0-9]+)\\\",\\\"(?<columns>[0-9]+)\\\"$",RegexOptions.Compiled);
      int total=0,nonzero=0,divisible=0,invalid=0;
      var targetMap=new Dictionary<string,long>(StringComparer.OrdinalIgnoreCase);
      var request=new HashSet<string>((targets??"").Split(new[]{','},StringSplitOptions.RemoveEmptyEntries),StringComparer.OrdinalIgnoreCase);
      foreach(string raw in lines){
        var m=row.Match(raw.TrimStart('\uFEFF'));if(!m.Success)continue;
        total++;long cells=long.Parse(m.Groups["cells"].Value);long columns=long.Parse(m.Groups["columns"].Value);
        string name=m.Groups["schema"].Value+"."+m.Groups["name"].Value;
        if(cells>0)nonzero++;
        if(columns>0&&cells%columns==0){divisible++;if(request.Contains(name))targetMap.Add(name,cells/columns);}
        else invalid++;
      }
      var comparisons=new List<object>();int mismatch=0;
      foreach(string name in request){
        long inferred;
        if(!targetMap.TryGetValue(name,out inferred)){comparisons.Add(new{table=name,status="not_in_metadata"});mismatch++;continue;}
        string file=Path.Combine(folder,name+".csv");
        if(!File.Exists(file)){comparisons.Add(new{table=name,status="file_missing"});mismatch++;continue;}
        long actual;
        using(var reader=new StreamReader(file,Encoding.UTF8,true,131072)){actual=CountCsvRows(reader);}
        bool match=actual==inferred;if(!match)mismatch++;
        comparisons.Add(new {table=name,inferredRows=inferred,actualRows=actual,
          difference=actual-inferred,match=match,source="CSV and metadata; historical snapshot"});
      }
      var report=new {generatedAtUtc=DateTime.UtcNow.ToString("o"),source="historical CSV snapshot",tables=total,nonzero,
        divisibleByDeclaredColumns=divisible,invalidFormula=invalid,compared=targetMap.Count,
        mismatch,comparisons,warning="Never write to Jawafa_DB; inferred count is not a live database row count."};
      string json=Json.Serialize(report);
      string parent=Path.GetDirectoryName(Path.GetFullPath(destination));if(!Directory.Exists(parent))throw new DirectoryNotFoundException(parent);
      File.WriteAllText(destination,json,Encoding.UTF8);
      Console.WriteLine("INVENTORY_AUDIT="+json);
      Console.WriteLine("REPORT_SHA256="+Sha256(destination));
      return mismatch>0?2:0;
    }
    static string Sha256(string file) {
      using(var sha=SHA256.Create())using(var stream=File.OpenRead(file)){
        var bytes=sha.ComputeHash(stream);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();
      }
    }
  }
}
