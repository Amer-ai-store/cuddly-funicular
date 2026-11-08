import React from 'react';
import {Pressable,ScrollView,View} from 'react-native';
import {router} from 'expo-router';
import {Shell} from '../components/Shell';
import {ProductImage} from '../components/ProductCard';
import {Button,EmptyState,Txt} from '../components/ui';
import {formatPrice} from '../data/products';
import {useStore} from '../lib/store';
import {useTheme} from '../lib/theme';
export default function Compare(){
 const {colors:t}=useTheme();const {compareIds,products,settings,toggleCompare,addToCart}=useStore();
 const selected=compareIds.map(id=>products.find(p=>p.id===id)).filter((p):p is typeof products[number]=>!!p);
 return <Shell title="مقارنة المنتجات" subtitle="قارن السعر والمواصفات المتاحة في الكتالوج الحالي.">
  {!selected.length?<View style={{gap:14}}><EmptyState title="لا توجد منتجات للمقارنة" detail="أضف منتجات من تفاصيل المنتج لعرضها هنا."/><Button title="تصفح المنتجات" onPress={()=>router.push('/explore')}/></View>
  :<ScrollView horizontal contentContainerStyle={{flexDirection:'row-reverse',gap:12,paddingBottom:16}}>
   {selected.map(p=><View key={p.id} style={{width:245,padding:14,borderRadius:16,borderWidth:1,borderColor:t.line,backgroundColor:t.paper,gap:9}}>
    <Pressable accessibilityRole="button" onPress={()=>router.push(`/product/${p.id}`)} style={{width:'100%',height:185,backgroundColor:t.imageBackground,borderRadius:12,overflow:'hidden'}}><ProductImage product={p}/></Pressable>
    <Txt weight="bold" style={{fontSize:17}}>{p.name}</Txt><Txt style={{color:t.muted}}>{p.brand} · {p.category}</Txt>
    <Txt weight="extra" style={{fontSize:21,color:t.orange}}>{formatPrice(p.price,settings.currency)}</Txt>
    <Txt>التوفر: {p.stock===undefined?'غير معروف':p.stock}</Txt><Txt>التقييمات الموثقة: {p.reviews?`${p.rating} من ${p.reviews}`:'لا توجد بعد'}</Txt>
    <Txt weight="bold">المواصفات</Txt>{p.features.length?p.features.map((f,i)=><Txt key={i} style={{color:t.muted}}>• {f}</Txt>):<Txt style={{color:t.muted}}>لم تُضف مواصفات بعد.</Txt>}
    <Button title={p.hasVariants?"اختيار المقاس أو اللون":"أضف إلى السلة"} disabled={p.stock===0} onPress={()=>p.hasVariants?router.push(`/product/${p.id}`):addToCart(p.id)}/>
    <Button secondary title="إزالة من المقارنة" onPress={()=>toggleCompare(p.id)}/>
   </View>)}
  </ScrollView>}
 </Shell>;
}
