# مرز آزمایشی API — مستقرنشده

این سرویس مستقل و اختیاری است و به سایت مستقر، پل FCC، worker یا مدل متصل نشده است. برای آزمون محلی Node.js 22 لازم است. افزون بر GETهای health، هویت، فهرست و جزئیات و POST اعتبارسنجی، GET/POST طرح دستی با migrationهای محلی 011 و 012 آماده شده است. API در سایت مستقر فعال نیست؛ سایت فعلی همچنان مستقیم از Supabase استفاده می‌کند.

```sh
SUPABASE_URL=https://YOUR-STAGING.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_STAGING_KEY \
node server/start.mjs
node --test server/*.test.mjs
```

URL و کلید باید از محیط staging مستقل باشند؛ هیچ رمز، service-role key یا token را در مخزن و خط فرمان مشترک قرار ندهید. نمونه‌های بالا مقدار واقعی نیستند. پیش‌فرض فقط `127.0.0.1:4180` است. برای ادغام در مرورگر، معکوس‌پروکسی هم‌مبدأ TLS و محافظت در لبه لازم است؛ **این سرویس برای اینترنت عمومی یا production آماده نیست**. `/health` فقط liveness فرایند را می‌گوید نه سلامت Auth/DB. API بدون CORS و بدون cookie یا refresh session است؛ Bearer کاربر به Supabase Auth و سپس با همان token به PostgREST ارسال می‌شود تا RLS را دور نزند. `me` صرفاً شناسهٔ تأییدشده و `projects` حداکثر ۱۰۰ پروژهٔ اخیر بر اساس دسترسی RLS برمی‌گرداند؛ `possibly_more` نشان قطعیت تعداد نیست. pagination، RBAC چندعضوی، role و workspace جدید، rate limit توزیع‌شده، audit پایدار و health dependency هنوز پیاده نشده‌اند. POST اعتبارسنجی داده را ذخیره یا اجرا نمی‌کند؛ POST طرح دستی فقط revision داده را ذخیره می‌کند. planner واقعی، اجرا، sandbox و approval وجود ندارند.

توکن را فقط از طریق Authorization header و کانال TLS قابل اعتماد بفرستید. پاسخ‌ها `no-store` هستند، بدون ثبت token/body و با request ID تولیدشده در سرور. URL Supabase، کلید و TLS proxy را مدیر محیط امن تنظیم کند؛ هیچ مقدار staging یا credential واقعی از production کپی نکنید. تست‌های خودکار upstream را mock می‌کنند و اثبات محیط واقعی نیستند. استقرار و اعتبارسنجی دو کاربر با RLS، لاگ‌ها، محدودیت نرخ و تست نفوذ قبل از هر rollout ضروری است.

طرح دستی نیازمند migrationهای وابسته، `011_manual_plan_revisions.sql` و `012_manual_plan_idempotency.sql` در یک محیط آزمایشی سازگار است. GET آخرین revision و نسخهٔ خوانده‌شدهٔ پروژه را بازمی‌گرداند؛ `GET .../manual-plan/{revision}` یک revision مشخص را فقط برای مالک می‌خواند و فهرست تاریخچه نیست؛ POST با expected revision و نسخهٔ پروژه و کنترل تراکنشی DB revision جدید می‌سازد. پاسخ مبهم به معنی شکست قطعی نیست؛ retry خودکار انجام نمی‌شود، اما کلاینت می‌تواند همان بدنه و header `Idempotency-Key` (UUID) را دوباره بفرستد تا موفقیت ثبت‌شده بازپخش شود. صرف خواندن آخرین revision برای رفع ابهام کافی نیست. GET snapshot اتمیک نیست؛ revisionها سقف ۲۰۰ دارند. این کد نه UI است نه planner یا workflow؛ هیچ migration یا استقرار زنده انجام نشده است. قرارداد و محدودیت‌ها در `API_DOCUMENTATION.md` و `DATABASE_SCHEMA.md` آمده‌اند.

آزمون تراکنش PostgreSQL واقعی فقط روی cluster خالی و دورریختنی محلی اجرا شود، نه Supabase یا PostgreSQL شخصی. پس از ساخت database خالی `agent_studio_test` و فراهم‌کردن کاربر ادمین محلی، با `STUDIO_TEST_PG_URL` روی `127.0.0.1` دستور `npm run test:postgres --prefix site` را اجرا کنید. تست نقش و schema می‌سازد و پس از اجرای نخست cluster دیگر خالی نیست؛ برای تکرار یک cluster تازه بسازید. CI از container مجزا و موقت استفاده می‌کند؛ دادهٔ واقعی به آن منتقل نشود.
