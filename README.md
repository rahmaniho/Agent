# Agent

مجموعهٔ منابع مهندسی نرم‌افزار / معماری / طراحی سایت.

## `kit/` — کیت گزیده از ECC

استخراج و گزینش بخش‌های مرتبط با **مهندسی نرم‌افزار، معماری نرم‌افزار و طراحی و ساخت سایت(نسخهٔ 2.2.3، لایسنس MIT):

- `kit/skills/` — ۶۲ مهارت (فرانت‌اند و طراحی UI، معماری، API، دیتابیس، تست/TDD، امنیت، کارایی، مستندسازی)
- `kit/agents/` — ۲۴ agent تخصصی (architect، code-reviewer، react-reviewer، a11y-architect، seo-specialist و ...)
- `kit/commands/` — ۱۶ اسلش-کامند (`/code-review`, `/feature-dev`, `/plan`, `/quality-gate`, ...)
- `kit/rules/` — قواعد `common`, `web`, `react`, `typescript`
- `kit/CATALOG.md` — فهرست کامل مهارت‌ها با توضیح
- `kit/install-kit.sh` — نصب در `~/.claude` یا مسیر دلخواه (با `--dry-run` و پشتیبان‌گیری)

```bash
cd kit && ./install-kit.sh --dry-run     # پیش‌نمایش
cd kit && ./install-kit.sh               # نصب در ~/.claude
```

جزئیات بیشتر: [`kit/README.md`](kit/README.md)

## `site/` — ECC Playbook (وب‌اپ خدمت‌محور)

وب‌اپ فارسی/RTL که کاتالوگ کامل ریپوی ECC (۳۱۴ اسکیل، ۹۸ دستور، ۷۱ agent) را به **نیاز واقعی بازدیدکننده** نگاشت می‌کند: ۱۵ مسیر خدمت، هر کدام با مراحل، جعبه‌ابزار (اسکیل/دستور/agent)، ۳۸ پرامپت آماده برای کپی، فهرست تله‌های رایج و خروجی مورد انتظار.

**آنلاین:** <https://rahmaniho.github.io/Agent/> — استقرار خودکار با GitHub Pages (`.github/workflows/pages.yml`).

```bash
node site/serve.mjs      # http://localhost:4173
```

جزئیات: [`site/README.md`](site/README.md)
