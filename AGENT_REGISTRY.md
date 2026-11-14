# رجیستری ایجنت‌ها

**پیشنهادی؛ اجرا و رجیستری سروری وجود ندارد.** `kit/agents` و catalog شامل تعریف/متن هستند، نه ایجنت زنده. FCC محلی یکپارچگی با پروژه یا این رجیستری ندارد.

هر revision immutable پیشنهادی: شناسه، نسخه، نام فارسی، توضیح و هدف، ورودی/خروجی JSON Schema، مدل/نسخهٔ مجاز، capabilities، ابزارهای دقیق و scope، ریسک هر ابزار، سقف زمان/توکن/هزینه، policy retry، مالک و وضعیت active/revoked. ثبت/فعال‌سازی فقط توسط نقش مجاز و همراه audit؛ تغییر تعریف revision جدید می‌سازد، run به revision قدیمی pin می‌شود. لیست registry وضعیت «تعریف شده» را از «آمادهٔ اجرا و سلامت provider تأییدشده» جدا می‌کند.

نقش‌های نامزد، نه ایجنت موجود: planner (فقط پیشنهاد plan)، researcher (خواندن منابع صریحاً مجاز)، implementer (تغییر در workspace ایزوله با ابزار مجاز)، reviewer (بازبینی artifact)، coordinator (هماهنگ‌سازی از طریق orchestrator). هر handoff شامل ID خروجی و provenance واقعی است؛ هر role به خودی خود دسترسی شبکه، secrets، shell یا استقرار ندارد. غیرفعال/ناموجود بودن مدل یا ابزار باید آشکار شود. معیار پذیرش: اعتبارسنجی schema، مجوز ثبت و فراخوانی، immutability، انکار tool خارج allowlist و ثبت مصرف و audit در staging.
