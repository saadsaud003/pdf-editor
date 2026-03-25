# تحويل التطبيق إلى APK باستخدام GitHub Actions

## نظرة عامة

يستخدم هذا المشروع **Capacitor.js** لتغليف تطبيق الويب كتطبيق Android أصلي، و**GitHub Actions** لبناء ملف APK تلقائياً.

---

## المتطلبات

- حساب GitHub
- Node.js 20+
- رفع المشروع إلى مستودع GitHub

---

## الخطوات

### 1. إعداد المشروع محلياً (اختياري)

```bash
# تثبيت الاعتمادات
npm install

# إضافة منصة Android
npx cap add android

# مزامنة الملفات
npx cap sync android

# بناء APK محلياً (يتطلب Android Studio)
cd android && ./gradlew assembleDebug
```

### 2. رفع المشروع إلى GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/pdf-editor.git
git push -u origin main
```

### 3. البناء التلقائي

بعد الرفع إلى GitHub، سيعمل GitHub Actions تلقائياً على:

1. **تثبيت** Node.js و Java JDK 17 و Android SDK
2. **تثبيت** اعتمادات npm
3. **إعداد** Capacitor وإضافة Android
4. **بناء** ملف APK (Debug)
5. **رفع** الملف كـ Artifact يمكن تحميله

### 4. تحميل ملف APK

1. اذهب إلى مستودعك على GitHub
2. اضغط على تبويب **Actions**
3. اختر آخر عملية بناء ناجحة (علامة ✓ خضراء)
4. انزل إلى قسم **Artifacts**
5. اضغط على **pdf-editor-debug** لتحميل ملف APK

### 5. إصدار نسخة Release

لبناء نسخة Release مع إصدار تلقائي على GitHub:

```bash
git tag v1.0.0
git push origin v1.0.0
```

هذا سينشئ:
- ملف APK بنسخة Debug
- ملف APK بنسخة Release
- إصدار GitHub Release تلقائي مع ملاحظات الإصدار

---

## هيكل الملفات

```
pdf-editor/
├── .github/
│   └── workflows/
│       └── build-apk.yml      ← سير عمل GitHub Actions
├── package.json               ← اعتمادات Capacitor
├── capacitor.config.json      ← إعدادات Capacitor
├── index.html                 ← نقطة الدخول
├── css/
├── js/
├── sw.js
└── manifest.json
```

---

## شرح الملفات

### `package.json`
يحتوي على اعتمادات Capacitor:
- **@capacitor/core**: النواة الأساسية
- **@capacitor/android**: دعم Android
- **@capacitor/cli**: أدوات سطر الأوامر
- **@capacitor/filesystem**: الوصول لنظام الملفات
- **@capacitor/share**: مشاركة الملفات
- **@capacitor/status-bar**: التحكم بشريط الحالة
- **@capacitor/splash-screen**: شاشة البداية

### `capacitor.config.json`
إعدادات التطبيق:
- **appId**: معرف التطبيق الفريد (`com.pdfeditor.app`)
- **appName**: اسم التطبيق بالعربية
- **webDir**: مجلد ملفات الويب (الجذر `.`)
- **plugins**: إعدادات الإضافات (شاشة البداية، شريط الحالة)

### `build-apk.yml`
سير عمل GitHub Actions:
- **المشغلات**: Push إلى main، Tags بـ `v*`، أو تشغيل يدوي
- **الخطوات**: إعداد البيئة ← تثبيت ← بناء ← رفع APK
- **Release**: يُنشأ تلقائياً عند إضافة Tag

---

## تخصيص التطبيق

### تغيير معرف التطبيق
عدّل `appId` في `capacitor.config.json`:
```json
"appId": "com.yourname.pdfeditor"
```

### تغيير أيقونة التطبيق
بعد إضافة Android:
1. استبدل الأيقونات في `android/app/src/main/res/`
2. أو استخدم صفحة `generate-icons.html` لتوليد الأيقونات

### توقيع APK للنشر على Play Store
أضف هذه الأسرار في GitHub Settings → Secrets:
- `KEYSTORE_BASE64`: ملف keystore مشفر بـ base64
- `KEYSTORE_PASSWORD`: كلمة مرور keystore
- `KEY_ALIAS`: اسم المفتاح
- `KEY_PASSWORD`: كلمة مرور المفتاح

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| فشل البناء | تحقق من تبويب Actions لمعرفة الخطأ |
| APK لا يعمل | تأكد من تفعيل "مصادر غير معروفة" في إعدادات الجهاز |
| ملفات كبيرة | أضف `.gitignore` لاستبعاد `node_modules` و `android/` |

---

## ملاحظات مهمة

- ملف APK الناتج من Debug **غير موقع** ولا يصلح للنشر على Play Store
- لنشر التطبيق على Play Store، يجب توقيع APK بمفتاح خاص
- حجم APK التقريبي: 5-15 ميجابايت
- يدعم Android 5.0 (API 21) فما أعلى
