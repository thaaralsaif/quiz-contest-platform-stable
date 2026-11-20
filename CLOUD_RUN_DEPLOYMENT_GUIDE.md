# 🚀 دليل النشر على Google Cloud Run (Free Tier)

**المنصة**: منصة المسابقات الهجينة متعددة الشاشات v10.1  
**التكلفة**: **مجاني تماماً** ضمن Free Tier (2 مليون طلب/شهر، 180k vCPU-second)  
**المتطلبات**: حساب Google Cloud، مشروع مفوترة مفعّل (للـ Free Tier فقط، لا يتم خصم رسوم)

---

## 📋 المتطلبات المسبقة

```bash
# 1. تثبيت Google Cloud CLI
# Windows: تحميل من https://cloud.google.com/sdk/docs/install
# Mac/Linux: curl https://sdk.cloud.google.com | bash

# 2. تسجيل الدخول وتعيين المشروع
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# 3. تفعيل الخدمات المطلوبة
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

---

## 🗄️ الخيار أ: SQLite محلي في Container (الأبسط، مجاني 100%)

> **ملاحظة**: Cloud Run يعيد إنشاء الـ container عند كل نشر/إعادة تشغيل، لذا ملف SQLite سيفقد البيانات.
> **الحل**: استخدم **Cloud SQL** (الخيار ب) للإنتاج، أو هذا الخيار للاختبار فقط.

---

## 🗄️ الخيار ب: Cloud SQL for SQLite (موصى به للإنتاج، ضمن Free Tier)

### 1. إنشاء مثيل Cloud SQL
```bash
# اسم المثيل
INSTANCE_NAME=trivia-db
REGION=us-central1  # أو europe-west1, asia-northeast1

# إنشاء مثيل SQLite (PostgreSQL/MySQL أيضاً مدعومان، لكن الكود يستخدم SQLite)
gcloud sql instances create $INSTANCE_NAME \
  --database-version=SQLITE \
  --tier=db-f1-micro \
  --region=$REGION \
  --storage-type=SSD \
  --storage-size=10GB \
  --availability-type=zonal \
  --no-deletion-protection

# إنشاء قاعدة البيانات
gcloud sql databases create trivia --instance=$INSTANCE_NAME

# إنشاء مستخدم (كلمة مرور قوية)
gcloud sql users create trivia-user \
  --instance=$INSTANCE_NAME \
  --password="$(openssl rand -base64 32)"
```

### 2. إعداد Secret Manager لبيانات الاتصال
```bash
# تخزين كلمة المرور بأمان
echo -n "YOUR_DB_PASSWORD" | gcloud secrets create db-password --data-file=-

# تخزين PIN المضيف
echo -n "YOUR_SECURE_6_DIGIT_PIN" | gcloud secrets create host-pin --data-file=-

# منح Cloud Run صلاحية القراءة
gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding host-pin \
  --member="serviceAccount:$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 🐳 بناء ونشر الصورة على Cloud Run

### الطريقة السريعة: `gcloud run deploy` (بناء تلقائي عبر Cloud Build)

```bash
# من مجلد المشروع
cd C:\Users\ll\Downloads\منصة-المسابقات-النسخة-10.0-المستقرة

# النشر مع متغيرات البيئة و Cloud SQL
gcloud run deploy trivia-platform \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --concurrency 80 \
  --timeout 300 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="HOST_PIN=host-pin:latest" \
  --add-cloudsql-instances=$(gcloud sql instances describe trivia-db --format='value(connectionName)')
```

### الطريقة المتقدمة: بناء يدوي + Artifact Registry (أسرع للـ CI/CD)

```bash
# 1. إنشاء مستودع Artifact Registry
gcloud artifacts repositories create trivia-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Trivia Platform Docker Images"

# 2. بناء الصورة ودفعها
gcloud builds submit --tag us-central1-docker.pkg.dev/$PROJECT_ID/trivia-repo/trivia-platform:latest .

# 3. النشر من الصورة المبنية
gcloud run deploy trivia-platform \
  --image us-central1-docker.pkg.dev/$PROJECT_ID/trivia-repo/trivia-platform:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --concurrency 80 \
  --timeout 300 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="HOST_PIN=host-pin:latest" \
  --add-cloudsql-instances=$(gcloud sql instances describe trivia-db --format='value(connectionName)')
```

---

## ⚙️ متغيرات البيئة المطلوبة في Cloud Run

| المتغير | القيمة | المصدر |
|-----------|--------|--------|
| `NODE_ENV` | `production` | `--set-env-vars` |
| `PORT` | `8080` | تلقائي من Cloud Run |
| `HOST_PIN` | رمز PIN قوي (6+ أرقام) | `--set-secrets` من Secret Manager |

**اختيارية** (إذا لم تستخدم Cloud SQL):
| المتغير | القيمة |
|-----------|--------|
| `DATABASE_PATH` | `/app/data/trivia.sqlite` (مسار داخل الـ container) |

---

## 🔗 ربط Cloud SQL بـ Node.js (تعديل بسيط في الكود)

Cloud Run يوفر **Unix Domain Socket** للاتصال بـ Cloud SQL في المسار:
```
/cloudsql/<PROJECT_ID>:<REGION>:<INSTANCE_NAME>
```

**في `server/persistence.ts`، عدّل دالة `createDatabase()`:**
```typescript
function getDatabasePath(): string {
  // في Cloud Run مع Cloud SQL
  if (process.env.INSTANCE_CONNECTION_NAME) {
    return `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}/trivia.sqlite`;
  }
  // محلياً أو بدون Cloud SQL
  return path.join(DATA_DIR, 'trivia.sqlite');
}

export function createDatabase(): Database.Database {
  ensureDataDir();
  const db = new Database(getDatabasePath());
  // ... باقي الكود كما هو
}
```

> **ملاحظة**: `INSTANCE_CONNECTION_NAME` يُضبط تلقائياً عند استخدام `--add-cloudsql-instances`

---

## ✅ التحقق من النشر

```bash
# الحصول على عنوان URL الخدمة
SERVICE_URL=$(gcloud run services describe trivia-platform --region=us-central1 --format='value(status.url)')

echo "🌐 المنصة متاحة على: $SERVICE_URL"
echo "🔌 WebSocket: ${SERVICE_URL/https:/wss:}/ws"
echo "❤️  Health Check: $SERVICE_URL/api/health"

# اختبار Health Check
curl $SERVICE_URL/api/health

# اختبار WebSocket (يتطلب wscat: npm i -g wscat)
wscat -c ${SERVICE_URL/https:/wss:}/ws
```

---

## 📊 المراقبة والسجلات

```bash
# عرض السجلات المباشرة
gcloud run services logs tail trivia-platform --region=us-central1

# عرض السجلات الأخيرة (100 سطر)
gcloud run services logs read trivia-platform --region=us-central1 --limit=100

# مقاييس الأداء في Cloud Console
# https://console.cloud.google.com/run/detail/us-central1/trivia-platform/metrics
```

**المقاييس المهمة للمراقبة:**
| المقياس | الهدف | تنبيه عند |
|----------|-------|-----------|
| Request latency (p95) | < 200ms | > 500ms |
| Active WebSocket connections | ≤ 50 | > 80 |
| Memory utilization | < 400MB | > 450MB |
| CPU utilization | < 60% | > 80% |
| Error rate | 0% | > 1% |
| Cold starts | نادر | متكرر |

---

## 💰 تقدير التكاليف (Free Tier)

| المورد | Free Tier الشهري | الاستخدام المتوقع | التكلفة بعد Free Tier |
|---------|------------------|------------------|----------------------|
| **Cloud Run Requests** | 2 مليون طلب | ~50k/حدث | $0.40/مليون |
| **Cloud Run CPU** | 180,000 vCPU-sec | ~50k/حدث | $0.000024/vCPU-sec |
| **Cloud Run Memory** | 360,000 GiB-sec | ~100k/حدث | $0.0000025/GiB-sec |
| **Cloud SQL (db-f1-micro)** | غير مشمول | 24/7 | ~$7/شهر |
| **Artifact Registry** | 0.5 GB تخزين | <100 MB | $0.10/GB/شهر |
| **Secret Manager** | 6 أسرار نشطة | 2 سر | $0.06/سر/شهر |
| **Cloud Build** | 120 دقيقة/يوم | 5-10 دقائق/نشر | $0.003/دقيقة |

**الخلاصة**: مع Cloud SQL db-f1-micro، التكلفة **~$7-10/شهر**.  
**بدون Cloud SQL** (SQLite في container، بيانات مؤقتة): **$0/شهر** بالكامل.

---

## 🔄 تحديث المنصة (نشر إصدار جديد)

```bash
# الطريقة السريعة
gcloud run deploy trivia-platform --source . --region=us-central1

# أو مع صورة جديدة
gcloud builds submit --tag us-central1-docker.pkg.dev/$PROJECT_ID/trivia-repo/trivia-platform:v1.1 .
gcloud run deploy trivia-platform --image us-central1-docker.pkg.dev/$PROJECT_ID/trivia-repo/trivia-platform:v1.1 --region=us-central1
```

---

## 🛠️ استكشاف الأخطاء الشائعة

### خطأ: "WebSocket connection failed"
```bash
# تأكد من أن المنفذ 8080 مستخدم في الكود (process.env.PORT || 8080)
# تحقق من سجلات Cloud Run:
gcloud run services logs read trivia-platform --region=us-central1 --limit=50
```

### خطأ: "SQLite database is locked"
- تأكد من تفعيل WAL mode في `persistence.ts` (مفعل بالفعل: `journal_mode = WAL`)
- تحقق من عدم وجود عمليات متعددة تكتب في نفس الوقت

### خطأ: "Out of memory" / "Container terminated"
```bash
# زيادة الذاكرة
gcloud run services update trivia-platform --memory=1Gi --region=us-central1
```

### خطأ: "Cold start بطيء"
- أضف `--min-instances=1` (يكلف قليلاً لكن يزيل cold starts)
- أو قلل حجم الصورة (`.dockerignore` محسّن بالفعل)

---

## 🔐 أمان إضافي (موصى به)

### 1. تقييد الوصول بـ IAP (Identity-Aware Proxy)
```bash
# تفعيل IAP على الخدمة
gcloud run services update trivia-platform --region=us-central1 --ingress=internal-and-cloud-load-balancing
# ثم إعداد IAP في Cloud Console
```

### 2. إعداد Custom Domain + SSL
```bash
# في Cloud Console > Cloud Run > الخدمة > Manage Custom Domains
# أو:
gcloud run domain-mappings create --service=trivia-platform --domain=trivia.yourdomain.com --region=us-central1
```

### 3. WAF (Web Application Firewall)
- تفعيل Cloud Armor مع قواعد OWASP Top 10

---

## 📝 قائمة تحقق قبل الفعالية (Event Day Checklist)

- [ ] `HOST_PIN` مضبوط في Secret Manager (6+ أرقام، غير افتراضي)
- [ ] Cloud SQL يعمل ويمكن الاتصال به من Cloud Run
- [ ] Health check يستجيب: `curl $SERVICE_URL/api/health`
- [ ] WebSocket يتصل: `wscat -c ${SERVICE_URL/https:/wss:}/ws`
- [ ] اختبار تدفق كامل: كمائن → سؤال → ضاغط → تقييم
- [ ] 8 فرق متزامنة تعمل بدون مشاكل
- [ ] السجلات نظيفة (لا أخطاء في `gcloud run services logs tail`)
- [ ] مراقبة مفعلة (UptimeRobot على `/api/health` كل 5 دقائق)
- [ ] نسخة احتياطية من قاعدة البيانات قبل الفعالية

---

## 📞 روابط مفيدة

- **Cloud Run Documentation**: https://cloud.google.com/run/docs
- **Cloud SQL for SQLite**: https://cloud.google.com/sql/docs/sqlite
- **Secret Manager**: https://cloud.google.com/secret-manager/docs
- **Cloud Run Pricing**: https://cloud.google.com/run/pricing
- **Free Tier Limits**: https://cloud.google.com/free/docs/free-cloud-features#run

---

## 🎯 ملخص أمر النشر السريع (Copy-Paste)

```bash
# استبدل YOUR_PROJECT_ID و YOUR_REGION
PROJECT_ID=your-project-id
REGION=us-central1

# 1. تفعيل الخدمات
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# 2. إنشاء سر PIN المضيف
echo -n "123456" | gcloud secrets create host-pin --data-file=-

# 3. النشر (يستخدم SQLite في container - بيانات مؤقتة)
gcloud run deploy trivia-platform \
  --source . \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --concurrency 80 \
  --timeout 300 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="HOST_PIN=host-pin:latest"

# 4. الحصول على الرابط
gcloud run services describe trivia-platform --region=$REGION --format='value(status.url)'
```

---

**تم إعداد هذا الدليل لـ منصة المسابقات v10.1 Production Ready**  
**تاريخ**: 2026-11-20  
**مطور بواسطة**: Claude (Anthropic) باستخدام مهارات النشر السحابي