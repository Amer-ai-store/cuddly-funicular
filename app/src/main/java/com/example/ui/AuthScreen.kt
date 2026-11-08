package com.example.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.*
import androidx.compose.ui.res.painterResource
import com.example.R

data class CountryDial(val flag: String, val code: String, val nameEn: String, val nameAr: String)

val worldCountries = listOf(
    CountryDial("🇯🇴", "+962", "Jordan", "الأردن"),
    CountryDial("🇸🇦", "+966", "Saudi Arabia", "السعودية"),
    CountryDial("🇦🇪", "+971", "UAE", "الإمارات"),
    CountryDial("🇪🇬", "+20", "Egypt", "مصر"),
    CountryDial("🇵🇸", "+970", "Palestine", "فلسطين"),
    CountryDial("🇸🇾", "+963", "Syria", "سوريا"),
    CountryDial("🇮🇶", "+964", "Iraq", "العراق"),
    CountryDial("🇱🇧", "+961", "Lebanon", "لبنان"),
    CountryDial("🇰🇼", "+965", "Kuwait", "الكويت"),
    CountryDial("🇶🇦", "+974", "Qatar", "قطر"),
    CountryDial("🇧🇭", "+973", "Bahrain", "البحرين"),
    CountryDial("🇴🇲", "+968", "Oman", "عمان"),
    CountryDial("🇾🇪", "+967", "Yemen", "اليمن"),
    CountryDial("🇲🇦", "+212", "Morocco", "المغرب"),
    CountryDial("🇩🇿", "+213", "Algeria", "الجزائر"),
    CountryDial("🇹🇳", "+216", "Tunisia", "تونس"),
    CountryDial("🇱🇾", "+218", "Libya", "ليبيا"),
    CountryDial("🇸🇩", "+249", "Sudan", "السودان"),
    CountryDial("🇺🇸", "+1", "USA", "أمريكا"),
    CountryDial("🇬🇧", "+44", "UK", "بريطانيا"),
    CountryDial("🇩🇪", "+49", "Germany", "ألمانيا"),
    CountryDial("🇫🇷", "+33", "France", "فرنسا"),
    CountryDial("🇮🇹", "+39", "Italy", "إيطاليا"),
    CountryDial("🇪🇸", "+34", "Spain", "إسبانيا"),
    CountryDial("🇹🇷", "+90", "Turkey", "تركيا"),
    CountryDial("🇮🇳", "+91", "India", "الهند"),
    CountryDial("🇵🇰", "+92", "Pakistan", "باكستان"),
    CountryDial("🇧🇩", "+880", "Bangladesh", "بنجلاديش"),
    CountryDial("🇨🇳", "+86", "China", "الصين"),
    CountryDial("🇯🇵", "+81", "Japan", "اليابان"),
    CountryDial("🇰🇷", "+82", "South Korea", "كوريا الجنوبية"),
    CountryDial("🇿🇦", "+27", "South Africa", "جنوب أفريقيا"),
    CountryDial("🇳🇬", "+234", "Nigeria", "نيجيريا"),
    CountryDial("🇧🇷", "+55", "Brazil", "البرازيل"),
    CountryDial("🇦🇷", "+54", "Argentina", "الأرجنتين"),
    CountryDial("🇦🇺", "+61", "Australia", "أستراليا")
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen(viewModel: MarketViewModel) {
    val SlateDarkBg = MaterialTheme.colorScheme.background
    val CardDarkBg = MaterialTheme.colorScheme.surface
    val PolarLight = MaterialTheme.colorScheme.onBackground

    val step by viewModel.verificationStep.collectAsState()
    val codeSent by viewModel.verificationCodeSent.collectAsState()
    val lang by viewModel.appLanguage.collectAsState()

    // Sign-in errors (e.g. the admin account without its password) are raised in the view model.
    val context = androidx.compose.ui.platform.LocalContext.current
    val errorMessage by viewModel.errorMessage.collectAsState()
    LaunchedEffect(errorMessage) {
        errorMessage?.let {
            android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }

    // Helper to get localized strings
    fun txt(key: String): String = Localization.get(key, lang)

    var isLoginMode by remember { mutableStateOf(false) } // false = Sign Up, true = Sign In
    val isAuthLoading by viewModel.isAuthLoading.collectAsState()

    // Sign Up Fields
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var signUpPassword by remember { mutableStateOf("") }
    var signUpPasswordConfirm by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("Customer") }
    var enteredCode by remember { mutableStateOf("") }
    var selectedCountry by remember { mutableStateOf(worldCountries[0]) } // Jordan is index 0
    var showCountryDropdown by remember { mutableStateOf(false) }

    // Sign In Fields
    var loginEmailOrPhone by remember { mutableStateOf("") }
    var loginPassword by remember { mutableStateOf("") }

    var errorMsg by remember { mutableStateOf<String?>(null) }

    // Admin is not offered at sign-up: that account opens only with ADMIN_PASSWORD on the sign-in tab.
    val roles = listOf("Customer", "Merchant", "Delivery")

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(SlateDarkBg, CardDarkBg, SlateDarkBg)
                )
            )
            .windowInsetsPadding(WindowInsets.safeDrawing)
    ) {
        // Floating Elegant Language Toggle Switch
        Row(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(CardDarkBg.copy(alpha = 0.85f))
                .border(1.dp, PrimaryCyan.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
                .clickable { viewModel.toggleLanguage() }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Settings,
                contentDescription = "Language Option",
                tint = PrimaryCyan,
                modifier = Modifier.size(16.dp)
            )
            Text(
                text = if (lang == "ar") "English" else "العربية",
                color = PolarLight,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Header Content
            Icon(
                painter = painterResource(id = R.drawable.ic_app_brand_logo),
                contentDescription = "AI Platform Logo",
                tint = Color.Unspecified,
                modifier = Modifier
                    .size(80.dp)
                    .padding(bottom = 12.dp)
            )

            Text(
                text = txt("app_title"),
                fontSize = 24.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.sp,
                color = Color(0xFFB71C1C),
                textAlign = TextAlign.Center,
                style = androidx.compose.ui.text.TextStyle(
                    shadow = androidx.compose.ui.graphics.Shadow(
                        color = Color(0xFFFF1744),
                        blurRadius = 16f
                    )
                )
            )

            Text(
                text = txt("app_subtitle"),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = SoftGrayText,
                modifier = Modifier.padding(top = 4.dp, bottom = 24.dp),
                textAlign = TextAlign.Center
            )

            AnimatedVisibility(
                visible = step == 0,
                enter = fadeIn(tween(400)) + slideInVertically(initialOffsetY = { 50 }, animationSpec = tween(400))
            ) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, PrimaryCyan.copy(alpha = 0.2f), RoundedCornerShape(24.dp)),
                    colors = CardDefaults.cardColors(containerColor = CardDarkBg.copy(alpha = 0.85f)),
                    shape = RoundedCornerShape(24.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        // Sliding Segmented Tab Control (Sign Up vs Sign In)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(44.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(SlateDarkBg)
                                .border(1.dp, SoftGrayText.copy(alpha = 0.15f), RoundedCornerShape(12.dp)),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .fillMaxHeight()
                                    .clickable { 
                                        isLoginMode = false 
                                        errorMsg = null
                                    }
                                    .background(if (!isLoginMode) PrimaryCyan else Color.Transparent),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    txt("sign_up_tab"),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (!isLoginMode) MaterialTheme.colorScheme.onPrimary else PolarLight
                                )
                            }
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .fillMaxHeight()
                                    .clickable { 
                                        isLoginMode = true 
                                        errorMsg = null
                                    }
                                    .background(if (isLoginMode) PrimaryCyan else Color.Transparent),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    txt("sign_in_tab"),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isLoginMode) MaterialTheme.colorScheme.onPrimary else PolarLight
                                )
                            }
                        }

                        if (!isLoginMode) {
                            // SIGN UP FORM
                            Text(
                                text = txt("create_account"),
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = PolarLight
                            )

                            OutlinedTextField(
                                value = name,
                                onValueChange = { name = it },
                                label = { Text(txt("full_name")) },
                                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null, tint = SecondaryMint) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("name_input"),
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = PrimaryCyan,
                                    unfocusedBorderColor = SoftGrayText.copy(alpha = 0.3f),
                                    focusedTextColor = PolarLight,
                                    unfocusedTextColor = PolarLight
                                )
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // Country Code Selector Box
                                Box(
                                    modifier = Modifier
                                        .height(56.dp)
                                        .width(100.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(CardDarkBg)
                                        .border(1.dp, SoftGrayText.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
                                        .clickable { showCountryDropdown = true }
                                        .padding(horizontal = 8.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text(selectedCountry.flag, fontSize = 20.sp)
                                        Text(selectedCountry.code, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = PolarLight)
                                        Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = SoftGrayText, modifier = Modifier.size(16.dp))
                                    }

                                    DropdownMenu(
                                        expanded = showCountryDropdown,
                                        onDismissRequest = { showCountryDropdown = false },
                                        modifier = Modifier.background(CardDarkBg).heightIn(max = 240.dp)
                                    ) {
                                        worldCountries.forEach { country ->
                                            DropdownMenuItem(
                                                text = {
                                                    Row(
                                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                        verticalAlignment = Alignment.CenterVertically
                                                    ) {
                                                        Text(country.flag, fontSize = 18.sp)
                                                        Text(country.code, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = PolarLight)
                                                        Text(if (lang == "ar") country.nameAr else country.nameEn, fontSize = 11.sp, color = SoftGrayText)
                                                    }
                                                },
                                                onClick = {
                                                    selectedCountry = country
                                                    showCountryDropdown = false
                                                }
                                            )
                                        }
                                    }
                                }

                                // Phone Input text field
                                OutlinedTextField(
                                    value = phone,
                                    onValueChange = { phone = it },
                                    label = { Text(txt("phone_num")) },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                                    modifier = Modifier
                                        .weight(1f)
                                        .testTag("phone_input"),
                                    shape = RoundedCornerShape(12.dp),
                                    singleLine = true,
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = PrimaryCyan,
                                        unfocusedBorderColor = SoftGrayText.copy(alpha = 0.3f),
                                        focusedTextColor = PolarLight,
                                        unfocusedTextColor = PolarLight
                                    )
                                )
                            }

                            OutlinedTextField(
                                value = email,
                                onValueChange = { email = it },
                                label = { Text(txt("email_addr")) },
                                leadingIcon = { Icon(Icons.Default.Email, contentDescription = null, tint = SecondaryMint) },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("email_input"),
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = PrimaryCyan,
                                    unfocusedBorderColor = SoftGrayText.copy(alpha = 0.3f),
                                    focusedTextColor = PolarLight,
                                    unfocusedTextColor = PolarLight
                                )
                            )

                            OutlinedTextField(
                                value = signUpPassword,
                                onValueChange = { signUpPassword = it },
                                label = { Text(txt("password")) },
                                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = SecondaryMint) },
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                supportingText = {
                                    Text(
                                        text = if (lang == "ar") "6 خانات فأكثر، مع حرف ورقم على الأقل" else "6+ characters, with at least one letter and one digit",
                                        fontSize = 9.sp,
                                        color = SoftGrayText
                                    )
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("signup_password_input"),
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = PrimaryCyan,
                                    unfocusedBorderColor = SoftGrayText.copy(alpha = 0.3f),
                                    focusedTextColor = PolarLight,
                                    unfocusedTextColor = PolarLight
                                )
                            )

                            OutlinedTextField(
                                value = signUpPasswordConfirm,
                                onValueChange = { signUpPasswordConfirm = it },
                                label = { Text(if (lang == "ar") "تأكيد كلمة المرور" else "Confirm Password") },
                                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = SecondaryMint) },
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("signup_password_confirm_input"),
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = PrimaryCyan,
                                    unfocusedBorderColor = SoftGrayText.copy(alpha = 0.3f),
                                    focusedTextColor = PolarLight,
                                    unfocusedTextColor = PolarLight
                                )
                            )

                            // Role Selection
                            Column {
                                Text(
                                    text = txt("select_role"),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = SoftGrayText,
                                    modifier = Modifier.padding(bottom = 4.dp)
                                )
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    roles.forEach { r ->
                                        val isSelected = role == r
                                        Box(
                                            modifier = Modifier
                                                .weight(1f)
                                                .height(36.dp)
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(if (isSelected) PrimaryCyan else CardDarkBg)
                                                .border(
                                                    1.dp,
                                                    if (isSelected) PrimaryCyan else SoftGrayText.copy(alpha = 0.2f),
                                                    RoundedCornerShape(8.dp)
                                                )
                                                .clickable { role = r }
                                                .wrapContentSize(Alignment.Center)
                                        ) {
                                            Text(
                                                text = when (r) {
                                                    "Customer" -> txt("role_customer")
                                                    "Merchant" -> txt("role_merchant")
                                                    "Delivery" -> txt("role_delivery")
                                                    "Admin" -> txt("role_admin")
                                                    else -> r
                                                },
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = if (isSelected) SlateDarkBg else PolarLight
                                            )
                                        }
                                    }
                                }
                            }

                            if (errorMsg != null) {
                                Text(
                                    text = errorMsg!!,
                                    color = AccentCoral,
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(vertical = 2.dp)
                                )
                            }

                            // Sign Up buttons
                            Button(
                                onClick = {
                                    if (name.trim().isEmpty() || email.trim().isEmpty()) {
                                        errorMsg = if (lang == "ar") "يرجى تعبئة الاسم والبريد الإلكتروني للتسجيل." else "Please fill in your name and email to register."
                                    } else if (!isStrongPassword(signUpPassword)) {
                                        errorMsg = if (lang == "ar") "كلمة المرور ضعيفة: 6 خانات فأكثر مع حرف ورقم على الأقل." else "Weak password: 6+ characters with at least one letter and one digit."
                                    } else if (signUpPassword != signUpPasswordConfirm) {
                                        errorMsg = if (lang == "ar") "كلمتا المرور غير متطابقتين." else "Passwords do not match."
                                    } else {
                                        errorMsg = null
                                        val fullPhone = if (phone.isBlank()) "" else selectedCountry.code + phone.trim()
                                        viewModel.initiateRegister(name.trim(), fullPhone, email, role, signUpPassword)
                                    }
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag("register_button"),
                                colors = ButtonDefaults.buttonColors(containerColor = PrimaryCyan),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                val onPrimaryColor = MaterialTheme.colorScheme.onPrimary
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Send,
                                        contentDescription = null,
                                        tint = onPrimaryColor,
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Text(
                                        text = txt("request_code"),
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Black,
                                        color = onPrimaryColor
                                    )
                                }
                            }
                        } else {
                            // SIGN IN FORM
                            Text(
                                text = txt("sign_in_title"),
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = PolarLight
                            )

                            OutlinedTextField(
                                value = loginEmailOrPhone,
                                onValueChange = { loginEmailOrPhone = it },
                                label = { Text(txt("enter_email_phone")) },
                                leadingIcon = { Icon(Icons.Default.Email, contentDescription = null, tint = PrimaryCyan) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("login_input"),
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = PrimaryCyan,
                                    unfocusedBorderColor = SoftGrayText.copy(alpha = 0.3f),
                                    focusedTextColor = PolarLight,
                                    unfocusedTextColor = PolarLight
                                )
                            )

                            OutlinedTextField(
                                value = loginPassword,
                                onValueChange = { loginPassword = it },
                                label = { Text(txt("password")) },
                                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = PrimaryCyan) },
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("password_input"),
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = PrimaryCyan,
                                    unfocusedBorderColor = SoftGrayText.copy(alpha = 0.3f),
                                    focusedTextColor = PolarLight,
                                    unfocusedTextColor = PolarLight
                                )
                            )

                            if (errorMsg != null) {
                                Text(
                                    text = errorMsg!!,
                                    color = AccentCoral,
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(vertical = 2.dp)
                                )
                            }

                            Button(
                                onClick = {
                                    if (loginEmailOrPhone.trim().isEmpty() || loginPassword.trim().isEmpty()) {
                                        errorMsg = if (lang == "ar") "يرجى إدخال البريد الإلكتروني/الهاتف وكلمة المرور." else "Please enter your Email/Phone and Password."
                                    } else {
                                        val ok = viewModel.login(loginEmailOrPhone, loginPassword)
                                        if (!ok) {
                                            errorMsg = if (lang == "ar") "بيانات الاعتماد غير صحيحة. يرجى التحقق والمحاولة مجدداً." else "Incorrect credentials. Please verify and retry."
                                        } else {
                                            errorMsg = null
                                        }
                                    }
                                },
                                enabled = !isAuthLoading,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag("login_confirm_btn"),
                                colors = ButtonDefaults.buttonColors(containerColor = PrimaryCyan),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                val onPrimaryColor = MaterialTheme.colorScheme.onPrimary
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Check,
                                        contentDescription = null,
                                        tint = onPrimaryColor,
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Text(
                                        text = if (isAuthLoading) (if (lang == "ar") "جارٍ التحقق..." else "Checking...") else txt("access_platform"),
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Black,
                                        color = onPrimaryColor
                                    )
                                }
                            }
                        }
                    }
                }
            }

            AnimatedVisibility(
                visible = step == 1,
                enter = fadeIn(tween(400)) + slideInVertically(initialOffsetY = { 50 }, animationSpec = tween(400))
            ) {
                // Verification Code flow for signup
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.dp, SecondaryMint.copy(alpha = 0.3f), RoundedCornerShape(24.dp)),
                        colors = CardDefaults.cardColors(containerColor = CardDarkBg.copy(alpha = 0.9f)),
                        shape = RoundedCornerShape(24.dp)
                    ) {
                        Column(
                            modifier = Modifier.padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Text(
                                text = txt("shield_sec"),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = SecondaryMint
                            )

                            Text(
                                text = if (lang == "ar") "تم إنشاء رمز أمان فريد مكون من 6 أرقام بواسطة مصفوفة مالي نيو مارت وإرساله إلى $email / $phone." else "A unique 6-digit access OTP has been compiled by the AI platform security matrix and sent to $email / $phone.",
                                fontSize = 13.sp,
                                color = SoftGrayText,
                                textAlign = TextAlign.Center
                            )

                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(WarmAmbar.copy(alpha = 0.15f))
                                    .border(1.dp, WarmAmbar.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                                    .padding(vertical = 12.dp, horizontal = 24.dp)
                            ) {
                                Text(
                                    text = txt("secret_msg") + "$codeSent",
                                    color = WarmAmbar,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = 1.sp
                                )
                            }

                            OutlinedTextField(
                                value = enteredCode,
                                onValueChange = { enteredCode = it },
                                label = { Text(txt("six_digit")) },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = PrimaryCyan) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("otp_input"),
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = SecondaryMint,
                                    unfocusedBorderColor = SoftGrayText.copy(alpha = 0.4f),
                                    focusedTextColor = PolarLight,
                                    unfocusedTextColor = PolarLight
                                )
                            )

                            if (errorMsg != null) {
                                Text(
                                    text = errorMsg!!,
                                    color = AccentCoral,
                                    fontSize = 12.sp
                                )
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                OutlinedButton(
                                    onClick = { viewModel.logout() },
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = SoftGrayText)
                                ) {
                                    Text(txt("back"))
                                }

                                Button(
                                    onClick = {
                                        val ok = viewModel.confirmCode(enteredCode.trim())
                                        if (!ok) {
                                            errorMsg = if (lang == "ar") "رمز غير صالح. يرجى التحقق وإعادة المحاولة." else "Invalid access key. Please verify and retry."
                                        } else {
                                            errorMsg = null
                                        }
                                    },
                                    enabled = !isAuthLoading,
                                    modifier = Modifier
                                        .weight(2f)
                                        .testTag("verify_confirm_button"),
                                    colors = ButtonDefaults.buttonColors(containerColor = PrimaryCyan),
                                    shape = RoundedCornerShape(12.dp)
                                ) {
                                    Text(
                                        text = txt("confirm_access"),
                                        fontWeight = FontWeight.Black,
                                        color = MaterialTheme.colorScheme.onPrimary
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
