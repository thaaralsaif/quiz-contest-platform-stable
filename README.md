<div align="center">
  <h1>🎯 منصة المسابقات الهجينة متعددة الشاشات</h1>
  <p><strong>Hybrid Multi-Screen Trivia Platform v10.1 Production Ready</strong></p>
  <p>منصة مسابقانية احترافية تدعم شاشات متعددة (TV + Mobile + Host) مع مزامنة فورية عبر WebSocket</p>
</div>

---

## ✨ المميزات الرئيسية

| الميزة | الوصف |
|----------|-------|
| **🖥️ شاشات متعددة** | TV View (الشاشة الرئيسية)، Mobile View (للاعبين)، Host View (للمقدم) |
| **⚡ مزامنة فورية** | WebSocket مع timer sync محسن (100ms interval) |
| **🎮 أنظمة تكتيكية** | كمائن، ضاغطات، تصويت سري، مبارزة، قنبلة، جولة نهائية |
| **🎨 6 ثيمات** | Luxury، Neon، Minimal، Dark، Retro، Nature |
| **🔒 أمان مؤسسي** | Helmet CSP، Rate Limiting، رموز 128-بت، HSTS |
| **💾 قاعدة بيانات ACID** | SQLite مع WAL mode، معاملات ذرية |
| **♿ إمكانية وصول** | WCAG AA، ARIA Live، Focus Visible، Keyboard Navigation |
| **🐳 جاهز للنشر** | Docker، Cloud Run، Kubernetes، PM2 |

---

## 🚀 التشغيل المحلي

### المتطلبات
```bash
Node.js >= 20.x
npm >= 10.x
```

### التثبيت والتشغيل
```bash
# 1. استنساخ/الدخول للمجلد
cd منصة-المسابقات-النسخة-10.0-المستقرة

# 2. تثبيت التبعيات
npm install

# 3. نسخ ملف البيئة وتعديله
cp .env.example .env
# عدل .env وأضف GEMINI_API_KEY و HOST_PIN

# 4. تشغيل وضع التطوير
npm run dev

# 5. فتح المتصفح
# http://localhost:3000
```

### نصوص NPM المتاحة
| الأمر | الوصف |
|-------|-------|
| `npm run dev` | تشغيل مع tsx + Vite HMR |
| `npm run build` | بناء الإنتاج (Vite) |
| `npm start` | تشغيل الإنتاج (يتطلب build أولاً) |
| `npm run lint` | فحص TypeScript |
| `npm test` | تشغيل الاختبارات (Vitest) |

---

## ☁️ النشر على Google Cloud Run (مجاني)

### الطريقة السريعة (سكريبت جاهز)
```bash
# 1. تأكد من تثبيت gcloud CLI وتسجيل الدخول
gcloud auth login

# 2. عيّن مشروعك
export GCP_PROJECT_ID=your-project-id

# 3. شغّل سكريبت النشر
./deploy-cloudrun.sh
```

### النشر اليدوي خطوة بخطوة
راجع **[CLOUD_RUN_DEPLOYMENT_GUIDE.md](CLOUD_RUN_DEPLOYMENT_GUIDE.md)** للدليل الكامل مع:
- إعداد Cloud SQL للقاعدة المستمرة
- Secret Manager للأسرار
- GitHub Actions CI/CD
- مراقبة وتنبيهات

### متغيرات البيئة للإنتاج
```env
NODE_ENV=production
PORT=8080
HOST_PIN=your-secure-6-digit-pin  # مطلوب!
# INSTANCE_CONNECTION_NAME=...    # يضبط تلقائياً مع --add-cloudsql-instances
```

---

## 🐳 النشر بـ Docker (أي منصة)

```bash
# بناء الصورة
docker build -t trivia-platform .

# تشغيل محلياً
docker run -p 8080:8080 \
  -e NODE_ENV=production \
  -e HOST_PIN=123456 \
  -v $(pwd)/data:/app/data \
  trivia-platform
```

---

## 📁 هيكل المشروع

```
├── server.ts              # Entry point: Express + WebSocket + Vite
├── server/
│   ├── engine.ts          # منطق اللعبة الرئيسي (3400+ سطر)
│   ├── persistence.ts     # SQLite persistence مع WAL
│   └── engine.test.ts     # اختبارات الوحدة
├── src/
│   ├── App.tsx            # Root component مع Error Boundary
│   ├── main.tsx           # React entry point
│   ├── index.css          # Tailwind + CSS Variables للثيمات
│   ├── components/
│   │   ├── TVView.tsx     # شاشة العرض الرئيسية
│   │   ├── MobileView.tsx # واجهة اللاعبين على الجوال
│   │   ├── HostView.tsx   # لوحة تحكم المقدم
│   │   ├── SettingsView.tsx # إعدادات اللعبة
│   │   ├── ViewNavBar.tsx # تنقل بين الشاشات
│   │   ├── PrintableReport.tsx # تقرير PDF قابل للطباعة
│   │   └── ErrorBoundary.tsx  # خطأ React مع استعادة
│   ├── hooks/
│   │   └── useTriviaRealtime.ts # WebSocket hook مع timer sync
│   ├── utils/
│   │   ├── audio.ts       # مؤثرات صوتية
│   │   ├── qr.ts          # توليد QR codes
│   │   └── excel.ts       # تصدير Excel
│   └── types/
│       └── game.ts        # جميع أنواع TypeScript
├── public/                # أصول ثابتة
├── data/                  # قاعدة بيانات SQLite (gitignored)
├── Dockerfile             # Multi-stage build لـ Cloud Run
├── .dockerignore
├── CLOUD_RUN_DEPLOYMENT_GUIDE.md  # دليل نشر مفصل
├── PRODUCTION_DEPLOYMENT_GUIDE.md # دليل نشر عام (PM2، Nginx)
├── deploy-cloudrun.sh     # سكريبت نشر سريع
└── .github/workflows/     # GitHub Actions CI/CD
```

---

## 🔧 التقنيات المستخدمة

| الطبقة | التقنيات |
|--------|----------|
| **Frontend** | React 19، TypeScript، Vite، TailwindCSS 4، Motion (Framer) |
| **Backend** | Node.js 20، Express، WebSocket (ws) |
| **Database** | SQLite (better-sqlite3)، WAL mode |
| **Security** | Helmet، express-rate-limit، crypto (128-bit tokens) |
| **Accessibility** | ARIA Live Regions، Focus Visible، Semantic HTML |
| **Build/Deploy** | Docker، Cloud Run، GitHub Actions، tsx |

---

## 🎮 تدفق اللعبة

```
Host View          TV View              Mobile View (×8 teams)
─────────────────────────────────────────────────────────────────
1. إعداد اللعبة    2. عرض اللوحة       3. انضمام بالـ Token/QR
   ├─ إعدادات        ├─ الفئات           ├─ اختيار الإجابة
   ├─ الفرق          ├─ النقاط           ├─ استخدام الضاغطات
   └─ PIN المضيف     └─ المؤقت           └─ التصويت السري
                                          └─ رؤية الكمائن
```

---

## ♿ إمكانية الوصول (WCAG AA)

- **ARIA Live Regions**: إعلانات فورية لتغييرات الحالة (polite/assertive)
- **Keyboard Navigation**: دعم كامل للوحة المفاتيح (Tab، Enter، Space، Arrow keys)
- **Focus Visible**: outline واضح على جميع العناصر التفاعلية
- **Screen Reader Support**: تسميات وصفية، أدوار صحيحة
- **Color Contrast**: تباين ألوان يحقق AA في جميع الثيمات الستة

---

## 🔐 الأمان

| الحماية | التنفيذ |
|----------|---------|
| **Rate Limiting HTTP** | 120 طلب/دقيقة/IP على `/api/`، 10/15د على auth |
| **Rate Limiting WS** | 10 اتصالات متزامنة/IP |
| **Backpressure** | قطع العملاء البطيئين (bufferedAmount > 16KB) |
| **Helmet CSP** | سياسة صارمة تمنع XSS |
| **Tokens** | 128-bit cryptographically secure (32 hex chars) |
| **HSTS** | مفعل في الإنتاج (max-age: 1 year) |
| **PIN Host** | مطلوب للإجراءات الحساسة، يخزن في Secret Manager |

---

## 📊 المراقبة والإنتاج

### Health Check
```bash
GET /api/health  # يعود { ok: true, now: timestamp }
```

### مقاييس مهمة
| المقياس | الهدف |
|----------|-------|
| API Latency (p95) | < 100ms محلياً، < 200ms Cloud Run |
| WS Connections | ≤ 50 (8 فرق × 3 شاشات + هامش) |
| Memory | < 200MB محلياً، < 400MB Cloud Run |
| Uptime | 99.9% |

### أوامر PM2 (للنشر على VM)
```bash
pm2 start server.ts --name trivia --interpreter tsx
pm2 save && pm2 startup
```

---

## 📝 الترخيص

مشروع خاص - جميع الحقوق محفوظة.

---

## 🤝 المساهمة

هذا المشروع مطوّر للمراجعة والنشر المباشر. للتحسينات:
1. Fork المشروع
2. أنشئ branch للميزة
3. قدم Pull Request مع وصف واضح

---

## 📞 الدعم

للاستفسارات التقنية أو مشاكل النشر:
- راجع `PRODUCTION_DEPLOYMENT_GUIDE.md` و `CLOUD_RUN_DEPLOYMENT_GUIDE.md`
- تحقق من السجلات: `gcloud run services logs tail trivia-platform --region=us-central1`
- تأكد من Health Check: `curl https://your-url/api/health`

---

<div align="center">
  <p><strong>تم التطوير والمراجعة بواسطة Claude (Anthropic)</strong></p>
  <p>باستخدام مهارات: Grill Analysis، Systematic Debugging، Cloud Deployment</p>
  <p>الإصدار 10.1 Production Ready — نوفمبر 2026</p>
</div>