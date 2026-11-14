# مرز آزمایشی API — فقط خواندن

این سرویس مستقل و اختیاری است و به سایت مستقر، پل FCC، worker، مدل یا پایگاه جدید متصل نشده است. برای آزمون محلی Node.js 22 لازم است. تنها `/api/v1/health`، `/api/v1/me` و `/api/v1/projects` با GET وجود دارند. API جدید نیست که در سایت مستقر فعال شده باشد؛ سایت فعلی همچنان مستقیم از Supabase استفاده می‌کند.

```sh
SUPABASE_URL=https://YOUR-STAGING.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_STAGING_KEY \
node server/start.mjs
node --test server/*.test.mjs
```

URL و کلید باید از محیط staging مستقل باشند؛ هیچ رمز، service-role key یا token را در مخزن و خط فرمان مشترک قرار ندهید. نمونه‌های بالا مقدار واقعی نیستند. پیش‌فرض فقط `127.0.0.1:4180` است. برای ادغام در مرورگر، معکوس‌پروکسی هم‌مبدأ TLS و محافظت در لبه لازم است؛ **این سرویس برای اینترنت عمومی یا production آماده نیست**. `/health` فقط liveness فرایند را می‌گوید نه سلامت Auth/DB. API بدون CORS و بدون cookie یا refresh session است؛ Bearer کاربر به Supabase Auth و سپس با همان token به PostgREST ارسال می‌شود تا RLS را دور نزند. `me` صرفاً شناسهٔ تأییدشده و `projects` حداکثر ۱۰۰ پروژهٔ اخیر بر اساس دسترسی RLS برمی‌گرداند؛ `possibly_more` نشان قطعیت تعداد نیست. pagination، RBAC چندعضوی، role و workspace جدید، rate limit توزیع‌شده، audit پایدار و health dependency هنوز پیاده نشده‌اند. هیچ عملیات نوشتن، اجرا، planning، sandbox یا approval وجود ندارد.

توکن را فقط از طریق Authorization header و کانال TLS قابل اعتماد بفرستید. پاسخ‌ها `no-store` هستند، بدون ثبت token/body و با request ID تولیدشده در سرور. URL Supabase، کلید و TLS proxy را مدیر محیط امن تنظیم کند؛ هیچ مقدار staging یا credential واقعی از production کپی نکنید. تست‌های خودکار upstream را mock می‌کنند و اثبات محیط واقعی نیستند. استقرار و اعتبارسنجی دو کاربر با RLS، لاگ‌ها، محدودیت نرخ و تست نفوذ قبل از هر rollout ضروری است.
