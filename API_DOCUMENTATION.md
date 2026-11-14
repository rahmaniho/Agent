# قرارداد API

## موجود

مرورگر مستقیماً به Supabase Auth، جداول دارای RLS و RPCهای `site/db` می‌رود. پروژه با `studio_projects` و filter `id` و `version` به‌روزرسانی/حذف می‌شود؛ نتیجهٔ صفر ردیف conflict فرض می‌شود. سرویس `site/serve.mjs` فقط فایل استاتیک و در حالت انتخابی local-only، مسیرهای allowlisted `api/fcc` را proxy می‌کند؛ API ابری محصول نیست. قرارداد دقیق RPCها در SQL نسخه‌دار است.

## پیشنهادی — اجرا نشده

همهٔ نمونه‌ها نامزد قراردادند نه endpoint قابل فراخوانی. API باید JWT را اعتبارسنجی و membership/role و object scope را در سرور بررسی کند؛ tenant ID ارسالی به‌تنهایی مجوز نیست. پاسخ خطا شامل code، پیام امن، correlation ID؛ بدون secrets. لیست‌ها cursor پایدار و سقف دارند؛ payloadها schema و size limit دارند.

| روش و مسیر پیشنهادی | رفتار |
|---|---|
| `GET/POST /api/projects`، `GET/PATCH /api/projects/{id}` | لیست مجاز/ایجاد/خواندن/ویرایش با `expected_version` و conflict 409؛ حذف نیازمند policy و تأیید لازم. |
| `GET/PUT /api/projects/{id}/draft` | wizard قابل ادامه، version و ذخیرهٔ وضعیت؛ 409 برای نسخهٔ قدیمی. |
| `POST /api/projects/{id}/plan-proposals` | درخواست planner واقعی با محدودیت، پاسخ ساختاریافته و provenance؛ عدم دسترسی provider = خطای مشخص. |
| `PATCH /api/plans/{id}`، `POST /api/plans/{id}/activate` | ویرایش و اعتبارسنجی DAG/وزن؛ فعال‌سازی فقط نسخهٔ معتبر با مجوز و تأیید موردنیاز. |
| `POST /api/runs`، `POST /api/runs/{id}/{pause,resume,cancel}` | transition سروری، version و idempotency key؛ cancel درخواست توقف است و پایان واقعی بعد از تأیید worker ثبت می‌شود. |
| `GET /api/runs/{id}/events?after=cursor` | بازپخش صفحه‌بندی‌شدهٔ event مجاز؛ اعلان reconnect/backfill؛ stream اختیاری. |
| `POST /api/approvals/{id}/decision` | فقط actor مجاز؛ digest، تاریخ انقضا و version کنترل و تصمیم اتمیک ثبت می‌شود. |
| `POST /api/commands/interpret` | پیشنهاد typed intent، بدون اجرای مستقیم؛ دستور جداگانه با کنترل مجوز و idempotency. |
| `GET /api/projects/{id}/artifacts`، `GET /api/projects/{id}/usage` | فایل‌های مجاز و مصرف ثبت‌شده؛ قیمت ناشناخته، ناشناخته نمایش داده می‌شود. |

عملیات اثرگذار باید `Idempotency-Key` و digest درخواست داشته باشند؛ تکرار همان کلید/بدنه نتیجهٔ قبلی و بدنهٔ متفاوت 409. scope کلید actor/tenant/action و retention صریح باشد. خطاها حداقل 400 validation، 401 بدون نشست، 403 مجوز، 404 برای object غیرقابل مشاهده، 409 conflict، 429 محدودیت و 503 برای dependency غیرقابل دسترس را پوشش دهند. هیچ نمونه API را قبل از پیاده‌سازی/تست عملیاتی فرض نکنید.

## پیاده‌سازی آزمایشی مرحلهٔ ۱ — خواندنی و مستقرنشده

`server/app.mjs` پیاده‌سازی مستقل Node 22 است؛ مرورگر و deployment فعلی به آن متصل نیستند. پیش‌فرض listen فقط loopback است. راه‌اندازی و محدودیت‌ها در `server/README.md`.

- `GET /api/v1/health`: `{ "status": "ok" }` فقط فرایند، بدون تست dependency.
- `GET /api/v1/me`: نیازمند `Authorization: Bearer <access token>`؛ پس از تأیید آنلاین با Supabase Auth فقط `{ "id": "..." }` برمی‌گرداند.
- `GET /api/v1/projects`: همان توکن کاربر به PostgREST داده می‌شود تا RLS اعمال شود؛ `{projects: [...], limit: 100, possibly_more: boolean}`. مرتب‌سازی `updated_at.desc,id.desc`؛ `possibly_more=true` یعنی ممکن است دادهٔ بیشتری باشد، نه شمارش واقعی. pagination پیاده نشده است.

مسیرهای دیگر در بخش اعتبارسنجی طرح در ادامه توضیح داده شده‌اند؛ query parameter پشتیبانی نمی‌شود. خطا `{error:{code,request_id}}` و header `X-Request-Id` دارد؛ 400 ورودی نامعتبر، 401 بدون توکن معتبر، 403 عدم مجوز upstream، 404 مسیر ناشناخته، 405 روش نامجاز و 503 dependency ناموجود/پاسخ نامعتبر. همهٔ پاسخ‌ها `no-store` هستند. آزمایش‌ها upstream را mock می‌کنند؛ RLS واقعی و readiness عملیاتی به‌طور مستقل در staging تأیید نشده‌اند.

## قرارداد پیشنهادی/پیاده‌سازی‌شده در migration پیش‌نویس (فعال نشده)

خواندن `studio_project_drafts` با توکن کاربر و RLS فقط ردیف خودش را بازمی‌گرداند. `studio_save_project_draft(draft, expected_revision)` و `studio_delete_project_draft(expected_revision)` هر دو آرایهٔ یک نتیجه با `applied` و `revision` برمی‌گردانند. نبود ردیف به معنی revision صفر است؛ حذف یک tombstone با revision جدید می‌گذارد. `applied=false` تعارض است نه موفقیت؛ خطای شبکه نتیجه را نامعلوم می‌کند و پیش از تلاش دوباره باید خوانده شود. عملیات به actor سروری و revision موجود وابسته است، نه `user_id` ورودی. این قرارداد در PostgreSQL آزمایشی تست شده، اما در پروژهٔ Supabase فعال/آزمایش نشده است.

## RPC سازگار کنترل نسخهٔ پروژه (در کد، فعال‌نشده)

`studio_update_project_cas(target_id uuid, expected_version integer, patch jsonb)` فقط کلیدهای `title`, `description`, `project_type`, `checklist` را می‌پذیرد. با RLS و هویت caller کار می‌کند؛ نتیجهٔ یک‌ردیفی `{applied, new_version, updated_at}` است. `applied=false` به معنی ردیف غیرقابل‌دسترسی یا نسخهٔ قدیمی است؛ خروجی بین این دو تمایز نمی‌گذارد. در صورت خطا یا پاسخ مبهم، UI مجدداً به‌صورت خودکار نمی‌نویسد و ویرایش را تا دریافت نسخهٔ تازه قفل می‌کند. فقط خطای دقیق `PGRST202` (تابع در schema cache موجود نیست) برای سازگاری با پایگاه قبلی به update مستقیم مشروط به version بازمی‌گردد؛ رابط این حالت را اعلام می‌کند. مجوزهای مستقیم قدیمی همچنان برقرارند و fallback کنترل سروری اجباری نیست. تابع حذف یا تأیید عملیات حساس نیست.

## جزئیات پروژه و اعتبارسنجی طرح — فقط API آزمایشی محلی

- `GET /api/v1/projects/{uuid}` توکن را با Auth بررسی می‌کند، `id` و `user_id` تأییدشده را به query دارای RLS می‌فرستد و در نبود/عدم دسترسی 404 می‌دهد. `user_id` داخلی در پاسخ بازگردانده نمی‌شود. این پیاده‌سازی فقط مدل مالک تکی فعلی را پوشش می‌دهد، نه tenant/RBAC چندنفره.
- `POST /api/v1/projects/{uuid}/plan-validation` فقط طرح ارائه‌شده را برای پروژهٔ مجاز اعتبارسنجی می‌کند؛ مدل، ذخیره‌سازی، activation و اجرا ندارد. بدنه حداکثر ۶۴ KiB و صرفاً JSON است. نمونهٔ فرضی ورودی:

```json
{"project_version": 3, "tasks": [{"id":"design", "title":"طراحی", "weight":2, "depends_on":[]}, {"id":"build", "title":"ساخت", "weight":3, "depends_on":["design"]}]}
```

۱ تا ۱۰۰ task، شناسهٔ یکتای کوچک لاتین، عنوان غیرخالی تا ۲۰۰ واحد UTF-16، وزن صحیح ۱ تا ۱۰۰۰ و حداکثر ۵۰ وابستگی معتبر، یکتا، داخلی و بدون چرخه لازم است. فیلد اضافی از جمله status یا agent رد می‌شود. نتیجهٔ موفق تنها تعداد، مجموع وزن و ترتیب توپولوژیک را دارد، نه پیشرفت یا نتیجهٔ کار. `422` طرح نامعتبر و مسیر خطا، `409` نسخهٔ قدیمی پروژه، `413` بدنهٔ بزرگ و `415` نوع دادهٔ نامجاز را نشان می‌دهد. خواندن نسخه و اعتبارسنجی در تراکنش مشترک با هیچ ذخیره‌ای نیست؛ نتیجهٔ موفق مجوز activation یا تضمین عدم تغییر بعدی پروژه نیست. سرویس روی production مستقر یا به UI وصل نشده است.

## طرح دستی نسخه‌دار — آزمایشی و مستقرنشده

`GET /api/v1/projects/{uuid}/manual-plan` آخرین revision مجاز را با `plan` و `current_project_version` می‌دهد؛ اگر طرحی نباشد `plan:null` است، وگرنه `stale` اختلاف نسخهٔ طرح و نسخهٔ خوانده‌شدهٔ پروژه را نشان می‌دهد. این دو query snapshot اتمیک مشترک ندارند و تغییر هم‌زمان می‌تواند پاسخ را قدیمی کند. `POST` همان مسیر با header تکی `Idempotency-Key` شامل UUID تازه و بدنهٔ `{"project_version":3,"expected_revision":0,"tasks":[{"id":"design","title":"طراحی","weight":1,"depends_on":[]}]}` فقط دادهٔ دستی را ذخیره می‌کند؛ `expected_revision=0` یعنی هنوز طرحی نیست. نتیجهٔ 201 شامل revision، نسخهٔ پروژه و زمان و `replayed:false` است؛ replay موفق 200 با `replayed:true` است. 409 با `project_version_conflict`, `plan_revision_conflict`, `revision_limit` یا `idempotency_key_conflict` و 422 برای ورودی نامعتبر است؛ طرح‌ها هیچ status، agent یا دستور اجرایی ندارند. سقف serialized taskها در API برای نوشتن ۵۵۰۰۰ بایت است تا در قالب JSONB زیر سقف ۶۴۰۰۰ بایت DB بماند؛ دادهٔ معتبر بزرگ‌تر ذخیره‌شده از RPC مستقیم قابل خواندن است. عنوان نامعتبر Unicode و NUL رد می‌شود.

در قطع ارتباط، timeout یا پاسخ مبهم، `plan_save_outcome_unknown` می‌تواند به معنی commit شدن باشد؛ retry خودکار انجام نمی‌شود. کلاینت باید UUID تصادفی، بدنه و پیش‌شرط‌های همان درخواست را برای retry صریح نگه دارد؛ همان کلید و بدنه در همان پروژه، حتی پس از revision یا تغییر نسخهٔ پروژه، نتیجهٔ commit قبلی را بازمی‌گرداند. کلید یک درخواست موفق با payload یا نسخهٔ متفاوت 409 می‌دهد. برابری payload در DB از نوع JSONB است: ترتیب کلیدهای object مهم نیست اما ترتیب آرایه‌ها مهم است. فقط درخواست موفق ثبت می‌شود؛ خطاها و conflictهای پیش از commit ذخیره یا بازپخش نمی‌شوند. کلید فقط در طول عمر revision، پروژه و مالکیت معتبر است؛ حذف پروژه/حساب، از دست دادن کلید، و revisionهای پیش از migration 012 قابلیت بازپخش را از بین می‌برد. صرف GET آخرین revision برای رفع ابهام کافی نیست. API با Auth آنلاین و توکن کاربر کار می‌کند؛ فهرست صفحه‌بندی‌شدهٔ تاریخچه ندارد و به UI/deployment متصل نیست. migrationهای 011 و 012 در Supabase اجرا نشده‌اند.


### خواندن revision مشخص

`GET /api/v1/projects/{uuid}/manual-plan/{revision}` با revision صحیح ۱ تا ۲۰۰، همان schema پاسخ طرح و نسخهٔ خوانده‌شدهٔ پروژه را بازمی‌گرداند؛ پروژه یا revision غیردردسترس 404 است و روش‌های نوشتن مجاز نیستند. مالکیت در query و RLS کنترل می‌شود؛ operation ID افشا نمی‌شود. این مسیر جزئیات یک revision شناخته‌شده را می‌خواند، نه فهرست تاریخچه؛ خواندن پروژه و طرح هنوز دو query با snapshot مجزا هستند و نمی‌توان صرف تطبیق محتوا را اثبات قطعی یک درخواست دانست. برای بازیابی نتیجهٔ مبهم، replay همان کلید و بدنه مسیر دقیق‌تری است. سرویس و migration در production فعال نیستند.
