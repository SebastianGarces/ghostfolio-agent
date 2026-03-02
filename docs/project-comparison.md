# AgentForge: Project Comparison & Recommendation

## TL;DR

**Choose Ghostfolio.** It's a full TypeScript monorepo with an existing AI integration layer, clean NestJS services that map directly to agent tools, and simple Docker deployment. OpenEMR is a massive PHP codebase with no LLM integration — it would require 3-5x more effort for the same outcome.

---

## Ghostfolio (Finance Domain)

### What It Does

Ghostfolio is an **open-source wealth management platform** for tracking stocks, ETFs, and cryptocurrencies across multiple brokerage accounts. It targets buy-and-hold investors seeking portfolio composition insights, performance analytics, and financial independence tracking.

**Core Features:**

- Multi-account portfolio management with performance metrics (ROAI, gross/net returns)
- Holdings breakdown by asset class, sector, country, and currency
- X-Ray analysis for portfolio risk identification (emergency fund, diversification, fees, cluster risk)
- Transaction management (buy, sell, dividend, fee, interest, liability)
- Dividend tracking and history
- Market data from multiple providers (Yahoo Finance, CoinGecko, Alpha Vantage, EOD, Financial Modeling Prep)
- CSV import/export, portfolio sharing, benchmarking
- PWA with dark mode, zen mode, and 13 language translations

### Architecture

| Layer             | Technology                                                        |
| ----------------- | ----------------------------------------------------------------- |
| **Backend**       | NestJS 11 (TypeScript)                                            |
| **Frontend**      | Angular 21 + Angular Material                                     |
| **Database**      | PostgreSQL via Prisma ORM                                         |
| **Cache/Queue**   | Redis + Bull job queues                                           |
| **Auth**          | JWT, Google OAuth2, OIDC, WebAuthn                                |
| **Build System**  | Nx monorepo                                                       |
| **AI (existing)** | `@openrouter/ai-sdk-provider` + `ai` SDK, dedicated AI controller |

**Folder Structure:**

```
ghostfolio/
├── apps/
│   ├── api/         # NestJS backend (controllers, services, modules)
│   └── client/      # Angular frontend
├── libs/
│   ├── common/      # Shared DTOs, interfaces, types (54+ interface files)
│   └── ui/          # Shared UI components (Storybook)
├── prisma/
│   └── schema.prisma  # Database schema
└── docker/          # Docker Compose configs (dev, prod, build)
```

### Key API Endpoints

| Endpoint                            | Purpose                                         |
| ----------------------------------- | ----------------------------------------------- |
| `GET /api/v1/portfolio/details`     | Full portfolio overview with holdings breakdown |
| `GET /api/v1/portfolio/performance` | Performance metrics over time ranges            |
| `GET /api/v1/portfolio/holdings`    | List all current holdings                       |
| `GET /api/v1/portfolio/dividends`   | Dividend history                                |
| `GET /api/v1/portfolio/report`      | X-Ray risk analysis                             |
| `GET/POST /api/v1/order`            | Transaction CRUD                                |
| `GET /api/v1/account`               | Account management                              |
| `POST /api/v1/import`               | Bulk transaction import                         |
| `GET /api/v1/export`                | Portfolio data export                           |
| `GET /api/v1/endpoints/market-data` | Market data lookup                              |
| `GET /api/v1/endpoints/ai`          | AI-powered insights (already exists!)           |

### Database Models (Prisma)

Key entities: `User`, `Account`, `Order` (transactions), `SymbolProfile` (securities), `MarketData` (price history), `AccountBalance`, `Tag`, `Platform`, `Access` (sharing), `Subscription`

Asset classes: EQUITY, FIXED_INCOME, COMMODITY, REAL_ESTATE, LIQUIDITY, ALTERNATIVE_INVESTMENT
Asset sub-classes: STOCK, ETF, BOND, CRYPTOCURRENCY, MUTUALFUND, PRECIOUS_METAL, CASH, etc.

### Deployment

```bash
# One command to run everything
docker compose -f docker/docker-compose.yml up -d
# 3 services: Ghostfolio API (:3333), PostgreSQL, Redis
```

Supports linux/amd64, linux/arm/v7, linux/arm64. Pre-built images on Docker Hub.

### Existing AI Integration

Ghostfolio **already has AI scaffolding**:

- `@openrouter/ai-sdk-provider` and `ai` packages in dependencies
- Dedicated AI endpoint controller at `apps/api/src/app/endpoints/ai/`
- Feature flag: `ENABLE_FEATURE_AI`
- Configurable AI model selection

---

## OpenEMR (Healthcare Domain)

### What It Does

OpenEMR is a **comprehensive open-source Electronic Health Records (EHR) and Medical Practice Management System**. It handles patient records, encounters, prescriptions, scheduling, billing, insurance claims, and patient portal access. It's HIPAA-compliant with FHIR R4 and US Core 8.0 support.

**Core Features:**

- Full EHR with patient demographics, encounters, vitals, lab results
- Practice management (scheduling, billing, insurance claims via EDI 837)
- Electronic prescriptions, drug management, allergy tracking
- FHIR R4 API with 30+ resources and SMART on FHIR v2.2 support
- Patient portal with separate API
- 37+ clinical form types, 49+ report types
- Multi-site support, LDAP integration, Twilio SMS

### Architecture

| Layer         | Technology                                     |
| ------------- | ---------------------------------------------- |
| **Backend**   | PHP 8.2+ with Laminas MVC + Symfony components |
| **Frontend**  | AngularJS 1.8 + jQuery 3.7 + Bootstrap 4.6     |
| **Database**  | MySQL/MariaDB via ADODB wrapper                |
| **Templates** | Smarty 4.5 + Twig 3.x (dual engine)            |
| **Auth**      | OAuth 2.0 / OpenID Connect                     |
| **Build**     | Composer (PHP) + Gulp/npm (frontend)           |
| **AI**        | None                                           |

**Folder Structure:**

```
openemr/           # ~4,272 PHP files, ~1GB
├── src/           # 1,867 modern PSR-4 PHP files
│   ├── Services/        # 286 service classes
│   ├── RestControllers/ # 90 REST/FHIR controllers
│   ├── FHIR/           # FHIR R4 implementation
│   └── Billing/        # EDI, insurance claims
├── library/       # Legacy procedural PHP
├── interface/     # Web UI (47 subdirectories)
├── sql/           # Schema + 45 migration scripts
├── docker/        # Multiple Docker variants
└── swagger/       # OpenAPI docs
```

### Key API Endpoints

| Endpoint                                              | Purpose               |
| ----------------------------------------------------- | --------------------- |
| `GET/POST /apis/default/api/patient`                  | Patient CRUD          |
| `GET/POST /apis/default/api/patient/{id}/encounter`   | Encounters            |
| `GET/POST /apis/default/api/patient/{id}/appointment` | Appointments          |
| `GET/POST /apis/default/api/drug`                     | Medication management |
| `GET/POST /apis/default/api/prescription`             | Prescriptions         |
| `GET/POST /apis/default/api/procedure`                | Procedures            |
| `GET /apis/default/fhir/Patient`                      | FHIR Patient resource |
| `GET /apis/default/fhir/MedicationRequest`            | FHIR Medications      |
| `GET /apis/default/fhir/AllergyIntolerance`           | FHIR Allergies        |
| 30+ additional FHIR R4 resources                      | Full FHIR coverage    |

### Database

100+ tables via ADODB (MySQL). Key tables: `patient_data`, `form_encounter`, `observations`, `lists` (diagnoses), `prescriptions`, `insurance_data`, `immunizations`, `billing_*`

### Deployment

```bash
cd docker/development-easy
docker compose up --detach --wait
# Services: OpenEMR (Apache+PHP), MariaDB, optional Redis/CouchDB/LDAP
# Access: http://localhost:8300 (admin/pass)
```

More complex than Ghostfolio — multiple Docker variants, requires PHP extensions (25+), larger resource footprint.

---

## Head-to-Head Comparison for Agent Building

| Criterion                   | Ghostfolio                       | OpenEMR                            | Winner     |
| --------------------------- | -------------------------------- | ---------------------------------- | ---------- |
| **Language**                | TypeScript (100%)                | PHP 8.2 (no TypeScript)            | Ghostfolio |
| **Existing AI integration** | OpenRouter SDK + AI controller   | None                               | Ghostfolio |
| **API cleanliness**         | NestJS with typed DTOs           | Mixed legacy + modern REST/FHIR    | Ghostfolio |
| **Tool-building ease**      | High — wrap existing TS services | Medium — PHP↔LLM glue needed       | Ghostfolio |
| **Frontend modernity**      | Angular 21 (current)             | AngularJS 1.8 (2013 era)           | Ghostfolio |
| **DB type safety**          | Prisma ORM (excellent)           | ADODB wrapper (legacy)             | Ghostfolio |
| **Deployment simplicity**   | 1 compose file, 3 services       | Multiple variants, more services   | Ghostfolio |
| **Codebase size**           | Manageable monorepo              | ~4,272 files, ~1GB                 | Ghostfolio |
| **Testing infrastructure**  | Jest (modern)                    | PHPUnit (adequate)                 | Ghostfolio |
| **Domain data richness**    | Good (portfolio, market data)    | Excellent (FHIR R4, 30+ resources) | OpenEMR    |
| **Regulatory complexity**   | Low (financial data, user-owned) | High (HIPAA, PHI handling)         | Ghostfolio |
| **Stack familiarity**       | Familiar (per user)              | Unknown                            | Ghostfolio |

**Score: Ghostfolio 11 — OpenEMR 1**

---

## Agent Tool Mapping

### Ghostfolio — Natural Tool Fit

These tools can be built by wrapping **existing** Ghostfolio services:

| Agent Tool                               | Existing Service/Endpoint              | Complexity                       |
| ---------------------------------------- | -------------------------------------- | -------------------------------- |
| `portfolio_analysis(userId)`             | `PortfolioService.getDetails()`        | Low — service exists             |
| `portfolio_performance(userId, range)`   | `PortfolioService.getPerformance()`    | Low — service exists             |
| `holdings_breakdown(userId, filters)`    | `PortfolioService.getHoldings()`       | Low — service exists             |
| `dividend_analysis(userId, range)`       | `PortfolioService.getDividends()`      | Low — service exists             |
| `risk_assessment(userId)`                | `PortfolioService.getReport()` (X-Ray) | Low — service exists             |
| `market_data_lookup(symbols)`            | Market data endpoints                  | Low — endpoint exists            |
| `transaction_history(userId, filters)`   | `OrderService` CRUD                    | Low — service exists             |
| `account_summary(userId)`                | `AccountService` + balances            | Low — service exists             |
| `tax_estimate(userId, year)`             | Trade history + dividend data          | Medium — needs calculation logic |
| `rebalancing_suggestion(userId, target)` | Holdings + allocation data             | Medium — needs new logic         |

### OpenEMR — Requires More Work

| Agent Tool                             | Existing Code                              | Complexity                       |
| -------------------------------------- | ------------------------------------------ | -------------------------------- |
| `drug_interaction_check(meds[])`       | Drug endpoints exist, no interaction logic | High — needs external API        |
| `symptom_lookup(symptoms[])`           | No existing service                        | High — needs external API        |
| `provider_search(specialty)`           | Practitioner data exists                   | Medium — needs search logic      |
| `appointment_availability(provider)`   | Appointment endpoints exist                | Medium — needs availability calc |
| `insurance_coverage_check(code, plan)` | Insurance data exists                      | High — needs coverage logic      |

---

## Recommendation

### Go with Ghostfolio

1. **Existing AI scaffolding** — OpenRouter SDK and AI controller are already in the codebase. You're not starting from zero.
2. **TypeScript everywhere** — Define LLM tool schemas with Zod, get type-safe tool execution, and use the Vercel AI SDK or LangChain.js natively.
3. **Services map to tools** — Portfolio analysis, performance, dividends, holdings, and risk assessment are already implemented as clean NestJS services. Wrapping them as agent tools is straightforward.
4. **Fast deployment** — One `docker-compose up` and you have a working app with PostgreSQL and Redis.
5. **Stack familiarity** — You already know the NestJS/Angular/TypeScript stack.
6. **Lower regulatory burden** — Financial portfolio data is user-owned and less regulated than healthcare PHI/HIPAA.
7. **Faster iteration** — Modern testing (Jest), type safety (Prisma), and clean architecture mean faster development cycles.
8. **24-hour MVP is realistic** — With existing services, you can have a working agent with 5+ tools in a day.

### OpenEMR would only make sense if:

- You specifically wanted healthcare domain experience
- You were comfortable with PHP and had no time pressure
- You wanted to work with FHIR R4 standards
- You didn't mind building LLM integration from scratch in PHP

**For a 1-week sprint with a 24-hour MVP gate, Ghostfolio is the only practical choice.**
