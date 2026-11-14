# پایگاه داده و نقشهٔ تکامل

**موجود:** `site/db/001_workspace_notes.sql` تا `008_catalog_review_editor.sql` مرجع طرح موجود هستند. `studio_projects` شامل UUID، `user_id`، title، description، project_type، checklist JSONB، version و زمان‌ها است؛ سیاست‌های مالکیت و دسترسی ستون‌ها در `006` اند. جزئیات و محدودیت compare-and-swap در `AUDIT_REPORT.md`.

## طرح پیشنهادی — هنوز migration ندارد

همهٔ شناسه‌ها UUID پایدار و همهٔ ردیف‌های مرتبط دارای `tenant_id` و در صورت نیاز `project_id` هستند. فرض اولیه یک workspace شخصی برای هر کاربر است؛ مدل عضویت چندنفره را بدون تحمیل سازمان‌سازی به دادهٔ فعلی اضافه کنید. جدول‌ها و نام‌ها طرح‌اند:

| موجودیت | فیلدهای کلیدی و قیدها |
|---|---|
| tenants, memberships | مالک، user، role، وضعیت؛ unique(tenant,user)، کنترل عضویت server-side. |
| projects / project_drafts | نگاشت صریح به `studio_projects.id`، version؛ draft مرحله و پاسخ‌ها، بدون نابودکردن checklist قدیمی. |
| plans / tasks / dependencies | plan version و status؛ task UUID، وزن مثبت، وضعیت، ترتیب؛ unique(plan, from, to)، کنترل هم‌پروژه و بدون cycle در تراکنش. |
| agent_definitions / revisions | ID و نسخهٔ immutable، نقش، capability/tool allowlist، محدودیت مدل و بودجه، active و ناشر مجاز. |
| workflow_runs / task_attempts | status، version، fence/lease، شمارش attempt و deadline؛ ارتباط با نسخهٔ plan و task. |
| approvals | actor، scope، action digest، version، expiry و decision؛ مصرف اتمیک، باطل هنگام تغییر عملیات. |
| events / outbox / checkpoints | sequence یکتای run، timestamp، payload محدود؛ outbox با delivery/retry؛ checkpoint نسخه‌دار و checksum. |
| idempotency_keys | actor/tenant، operation، key، digest درخواست، outcome و expiry با unique؛ تکرار digest متفاوت conflict. |
| artifacts / knowledge_sources | owner/tenant، project، نسخه، storage key خصوصی، checksum، منبع، اندازه، content type، وضعیت scan و دسترسی. |
| usage_records / budget_reservations | provider/model، مقدار و واحد واقعی، currency، price/version/source یا unknown، reservation و تسویهٔ idempotent. |
| audit_events | actor، tenant، action، object، زمان، outcome و correlation ID؛ عدم ذخیرهٔ secrets یا payloadهای حساس بی‌دلیل. |

از FKهای مرکب tenant/project و RLS مبتنی بر membership برای همهٔ مسیرهای خواندن/نوشتن استفاده شود؛ RLS به‌تنهایی جای مجوزهای عملیات و کار worker را نمی‌گیرد. indexهای tenant/project/status/زمان و sequence، uniqueهای idempotency، قیدهای nonnegative و foreign key الزامی‌اند. حذف و retention آگاهانه، audit و آرتیفکت نباید با cascade ناخواسته نابود شوند.

## برنامهٔ مهاجرت سازگار

1. backup مستقل با آزمون restore، شمارش و snapshot نسخه؛ staging و دادهٔ نماینده شامل checklist خالی و موارد تکراری.
2. expand بدون تغییر جدول جاری؛ برگرداندن دادهٔ اصلی و assignment شناسه به هر آیتم از طریق mapping پایدار `(project_id, index در snapshot, version)`؛ متن مشابه نباید یکی شود. migration تکرارپذیر؛ از فرض ID در JSON قدیمی پرهیز.
3. کنترل drift هنگام تغییر هم‌زمان: writer قدیمی را طی پنجرهٔ سازگار freeze یا سروری serialize کنید؛ تشخیص conflict صریح؛ هرگز silently overwrite یا دو منبع مرجع مستقل نداشته باشید. تعداد، ترتیب، متن و done را با snapshot و RLS مقایسه کنید.
4. ابتدا read جدید پشت feature flag، سپس writer جدید با CAS سروری، telemetry و دورهٔ سازگاری؛ قطع مستقیم‌نویسی تنها پس از کنترل نسخهٔ کلاینت و آزمون. rollback UI/read به مدل قبلی فقط تا وقتی تغییرات جدید بدون اتلاف به مدل قبلی قابل بازتاب‌اند؛ پس از نقطهٔ بدون بازگشت، بازگشت با restore/replay و runbook تأییدشده.
5. هیچ migration یا پاک‌سازی production بدون staging، تأیید، زمان‌بندی و طرح rollback انجام نمی‌شود.

## مقصد پایگاه داده

پایگاه production همان پروژهٔ Supabase قبلی `agent-studio` (`asxyjxxgpfsgfmabqqdw`) باقی می‌ماند؛ پروژه یا حساب کاربری جایگزین ساخته نمی‌شود. هر طرح آینده افزایشی، سازگار با نسخهٔ قبلی و با حفظ داده‌های فعلی است. آزمون ایزوله با دادهٔ ساختگی و بدون تغییر دادهٔ واقعی ضروری است؛ در صورت نیاز به ایجاد پروژهٔ آزمایشی جداگانه، ابتدا با کاربر هماهنگ می‌شود. این سند به‌تنهایی migration یا پشتیبان واقعی ایجاد نمی‌کند.

## migration آمادهٔ پیش‌نویس: `009_project_wizard_drafts.sql`

**در مخزن و فقط به‌صورت آزمایشی تست شده؛ روی Supabase زنده اجرا نشده است.** جدول `studio_project_drafts` یک ردیف برای هر کاربر دارد: `user_id`، `payload`، `revision` و `updated_at`. RLS خواندن را به مالک محدود و grant نوشتن مستقیم را لغو می‌کند. دو RPC با `auth.uid()` و اعتبارسنجی سروری فیلدها/اندازه، save و delete را با `expected_revision` تراکنشی انجام می‌دهند. `0` یعنی هنوز ردیفی وجود ندارد. حذف payload را null و revision را زیاد می‌کند تا stale writer پس از حذف و ایجاد مجدد نتواند تغییرات را بازنویسی کند؛ حذف حساب از طریق FK کل ردیف را حذف می‌کند. این حذف منطقی به معنی حذف فوری از WAL و backup نیست.

برای عرضه: ابتدا backup قابل‌بازیابی مستقل داده‌ها و طرح موجود، تست migration و منفی دو هویت در محیط جدا با schema/Auth مشابه، بررسی مجوزهای واقعی، برنامهٔ rollout و تأیید مالک؛ سپس migration افزایشی قبل از عرضهٔ UI. اگر UI زودتر عرضه شود، گزینهٔ حساب صریحاً خطای عدم دسترسی نشان می‌دهد و گزینهٔ محلی/پروژه‌های قبلی کار می‌کنند. rollback ترجیحی غیرفعال‌سازی UI جدید و نگه‌داشتن جدول و داده است؛ حذف جدول/توابع برگشت‌ناپذیر است و بدون تأیید، backup و درنظرگرفتن کلاینت‌های قدیمی مجاز نیست. وضعیت backup کامل و قابلیت restore هنوز اثبات نشده است.

## خواندن صفحه‌ای پروژه‌های موجود

کد رابط برای `studio_projects` از select مجاز کاربر و ترتیب `updated_at DESC, id DESC` با cursor مرکب استفاده می‌کند؛ شرط صفحهٔ بعد `updated_at < cursor_time OR (updated_at = cursor_time AND id < cursor_id)` است. رشتهٔ timestamp با microsecond بدون تبدیل به میلی‌ثانیه در cursor نگهداری می‌شود. RLS و جدول موجود تغییر نکرده‌اند. آزمون محلی PostgreSQL و serialization سازندهٔ Supabase انجام شده، ولی رفتار PostgREST و بار شاخص در production آزموده نشده‌اند. صفحه‌ها snapshot مشترک نیستند و هر تغییری در دادهٔ مرتب‌شده می‌تواند نیازمند تازه‌سازی باشد.

## migration افزایشی CAS پروژه: `010_project_update_cas.sql`

**آمادهٔ آزمون؛ روی پایگاه زنده اجرا نشده است.** RPC `studio_update_project_cas(target_id, expected_version, patch)` با `SECURITY INVOKER`، RLS مالک، ستون‌های محدود، اعتبارسنجی patch و شرط نسخه، update و افزایش version را در یک دستور اتمیک انجام می‌دهد؛ timestamp را سرور تعیین می‌کند. خروجی فقط `applied`, `new_version`, `updated_at` است. payload قدیمی چک‌لیست در update سایر فیلدها بازنویسی یا اجباراً به schema جدید تبدیل نمی‌شود.

این migration عمداً دسترسی UPDATE مستقیم نسخه‌های قدیمی را تغییر نمی‌دهد، پس **CAS برای تمام نویسندگان اجباری نیست** و یک کلاینت غیرهمکار هنوز می‌تواند کنترل نسخه را دور بزند. پس از پشتیبان و آزمون محیط مشابه، ابتدا RPC افزوده و کلاینت سازگار منتشر شود؛ فقط پس از رصد/بازنشستگی کلاینت قدیمی و طراحی مسیرهای insert/delete و approval می‌توان دربارهٔ لغو grant مستقیم تصمیم گرفت. حذف اجباری grant در این migration یا rollout بدون آزمون سازگاری ممنوع است. برای rollback، ابتدا کلاینت به روش قبلی برگردد و RPC تا خروج همهٔ کلاینت‌های جدید حفظ شود؛ حذف تابع تنها پس از تأیید و بررسی مصرف انجام شود. هیچ مجوز یا migration زنده‌ای در این گام تغییر نکرده است.

نکتهٔ مهم: تابع 010 با `SECURITY INVOKER` به grantهای UPDATE فعلیِ caller نیاز دارد؛ **لغو آن grantها بدون بازطراحی، خود RPC را هم از کار می‌اندازد**. الزام CAS سراسری نیازمند طراحی جداگانهٔ نقش/تابع محدود، ارزیابی RLS و مجوز و migration همهٔ نویسندگان است، نه صرفاً `REVOKE`.

## revision طرح دستی — migration `011_manual_plan_revisions.sql`

**فقط محلی؛ روی Supabase موجود اجرا نشده است.** جدول `studio_manual_plan_revisions` حداکثر ۲۰۰ revision برای هر پروژه دارد، کلید آن `(project_id, revision)` است و حذف پروژه یا حساب ردیف‌های وابسته را cascade می‌کند. RLS فقط خواندن مالک فعلی پروژه و revision را مجاز می‌کند؛ authenticated مجوز insert/update/delete مستقیم ندارد. تابع محدود `studio_save_manual_plan` از `auth.uid()` و `SECURITY DEFINER` با search path خالی استفاده می‌کند، ردیف پروژهٔ مالک را قفل و نسخهٔ پروژه و آخرین revision را در همان تراکنش بررسی و یک revision جدید درج می‌کند؛ فقط authenticated مجوز اجرای آن دارد. اعتبارسنجی DAG و محدودیت‌ها در خود DB نیز اجرا می‌شوند چون RPC را می‌توان مستقیماً فراخواند. revision ذخیره‌شده فعال‌سازی یا run نیست.

قفل، نوشتن‌های این RPC را نسبت به یکدیگر و ویرایش هم‌زمان ردیف پروژه serialize می‌کند، اما **نسخهٔ پروژه برای نویسندگان قدیمی قابل دور زدن است** (محدودیت migration 010). سقف ۲۰۰ تعمدی است؛ سیاست بایگانی/retention و افزایش سقف هنوز وجود ندارد. قبل از هر rollout باید مهاجرت‌های وابسته، مجوزهای واقعی و عملکرد/هم‌زمانی در محیط Supabase مشابه production، backup/restore و rollback با درنظرگرفتن داده‌های ایجادشده بررسی شوند؛ حذف جدول یا تابع می‌تواند داده یا کلاینت‌ها را از بین ببرد. PGlite اثبات پیکربندی production نیست.
