# کیت مهندسی نرم‌افزار، معماری و طراحی سایت

گزیده‌ای از ریپوی [affaan-m/ECC](https://github.com/affaan-m/ECC) (نسخهٔ `2.2.3`، کامیت `d2ef268`، لایسنس MIT) که فقط بخش‌های مرتبط با **مهندسی نرم‌افزار، معماری نرم‌افزار و طراحی/ساخت سایت** در آن نگه داشته شده است.

## محتویات

```
kit/
├── CATALOG.md      # فهرست کامل ۶۲ skill با توضیح فارسی‌شده/اصلی
├── skills/         # ۶۲ مهارت (SKILL.md + فایل‌های همراه)
├── agents/         # ۲۴ تعریف agent تخصصی
├── commands/       # ۱۶ اسلش-کامند
├── rules/          # ۴ بستهٔ قواعد: common, web, react, typescript
├── install-kit.sh  # نصب گزیده در ~/.claude (یا مسیر دلخواه)
└── LICENSE-ECC     # متن لایسنس MIT ریپوی مبدأ
```

## دسته‌بندی مهارت‌ها

| دسته | تعداد | نمونه‌ها |
|---|---|---|
| طراحی و ساخت سایت / فرانت‌اند | ۲۴ | `frontend-design-direction`, `design-system`, `make-interfaces-feel-better`, `react-patterns`, `motion-patterns`, `seo`, `accessibility` |
| معماری و طراحی نرم‌افزار | ۱۵ | `hexagonal-architecture`, `architecture-decision-records`, `blueprint`, `api-design`, `contract-first` |
| داده و زیرساخت | ۹ | `database-migrations`, `postgres-patterns`, `docker-patterns`, `kubernetes-patterns` |
| کیفیت: تست، بازبینی، امنیت، کارایی | ۱۱ | `tdd-workflow`, `e2e-testing`, `security-review`, `verification-loop`, `benchmark` |
| آنبوردینگ و مستندسازی | ۴ | `codebase-onboarding`, `code-tour`, `documentation-lookup`, `docs-governance` |

فهرست کامل با توضیح هر مورد: [`CATALOG.md`](CATALOG.md)

## agentها
`architect`, `code-architect`, `code-reviewer`, `code-explorer`, `code-simplifier`, `planner`, `react-reviewer`, `vue-reviewer`, `typescript-reviewer`, `database-reviewer`, `security-reviewer`, `performance-optimizer`, `refactor-cleaner`, `a11y-architect`, `seo-specialist`, `tdd-guide`, `react-build-resolver`, `e2e-runner`, `type-design-analyzer`, `silent-failure-hunter`, `pr-test-analyzer`, `comment-analyzer`, `doc-updater`, `spec-miner`

## commandها
`/code-review`, `/feature-dev`, `/plan`, `/plan-prd`, `/refactor-clean`, `/quality-gate`, `/security-scan`, `/test-coverage`, `/react-review`, `/react-build`, `/react-test`, `/build-fix`, `/review-pr`, `/multi-frontend`, `/project-init`, `/update-docs`

## نصب

```bash
# پیش‌نمایش مقصد (بدون نوشتن چیزی)
./install-kit.sh --dry-run

# نصب در ~/.claude (skills / agents / commands / rules)
./install-kit.sh

# نصب در مسیر دلخواه
./install-kit.sh --dest /path/to/project/.claude

# فقط skills
./install-kit.sh --only skills
```

اسکریپت هیچ فایل موجودی را بدون تهیهٔ نسخهٔ پشتیبان (.bak) بازنویسی نمی‌کند و `--dry-run` را پشتیبانی می‌کند.

## استفاده بدون نصب
هر skill یک پوشهٔ مستقل است؛ می‌توانید `skills/<name>/SKILL.md` را مستقیم در پرامپت خود ارجاع دهید یا به ابزار خود (Claude Code، Codex، Cursor، OpenCode و ...) بدهید. راهنمای نصب کامل ECC در ریپوی مبدأ موجود است.

## مجوز
محتوای کیت از ریپوی ECC با لایسنس **MIT** (Copyright © 2026 Affaan Mustafa) گرفته شده است؛ متن مجوز در [`LICENSE-ECC`](LICENSE-ECC) آمده است.
