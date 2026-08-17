# Estimate agent workload cost

This table estimates what one agent that never stops costs in model tokens.
Every figure comes from a dated price book and an estimated token rate, not
from an invoice. The day column is 24 hours at the stated rate. The month
column is 730 hours, the average month.

| Provider  | Model            | Steady: day / month | Saturated: day / month |
| --------- | ---------------- | ------------------: | ---------------------: |
| Anthropic | Claude Fable 5   |    $182.40 / $5,548 |      $408.00 / $12,410 |
| OpenAI    | GPT-5.6 Sol      |     $98.40 / $2,993 |       $216.00 / $6,570 |
| Anthropic | Claude Opus 5    |     $91.20 / $2,774 |       $204.00 / $6,205 |
| OpenAI    | GPT-5.6 Terra    |     $39.36 / $1,197 |        $86.40 / $2,628 |
| Anthropic | Claude Sonnet 5  |     $36.48 / $1,110 |        $81.60 / $2,482 |
| Anthropic | Claude Haiku 4.5 |       $18.24 / $555 |        $40.80 / $1,241 |
| OpenAI    | GPT-5.4 mini     |       $14.76 / $449 |          $32.40 / $986 |
| OpenAI    | GPT-5.6 Luna     |        $3.94 / $120 |           $8.64 / $263 |

Four notes apply to every row:

- **The two rates.** Steady is ordinary agent turns with repeated instructions:
  400K input, 600K cache-read, and 60K output tokens for each active hour.
  Saturated is continuous agentic coding with large tool results:
  1M / 2M / 100K.
- **Scope.** This is the model line only. It excludes substrate, tools,
  subagents, and cache writes. See
  [What this figure excludes](#what-this-figure-excludes).
- **Luna reserve.** Apply a five-times reserve to GPT-5.6 Luna until an invoice
  settles its disputed price. That gives $19.68 / $599 steady and
  $43.20 / $1,314 saturated.
- **Part-time agents.** Cost scales with active hours. Eight hours on each
  working day is about 176 hours, which is 24 percent of the month column.

At the same token rate, GPT-5.6 Sol costs about 25 times GPT-5.6 Luna and
Claude Fable 5 costs about 46 times. Apply the Luna reserve and those spreads
fall to 5 and 9 times. Against Claude Haiku 4.5, the cheapest model with an
undisputed price, they are 5.4 and 10 times. The two rates change the cost of
one model by about 2.2 times. Model choice and work intensity are separate
controls.

This guide calculates a planning estimate. It does not read invoices or collect
usage. See
[Replace estimates with measurements](#replace-estimates-with-measurements) for
the record that can replace each estimate later.

## Price book

Two providers, two capture dates. Prices are United States dollars for one
million text tokens.

OpenAI standard text-token prices, captured 2026-08-15 from the
[OpenAI model documentation](https://developers.openai.com/api/docs/models):

| Model         | Documented role                                 | Input | Cache read | Output |
| ------------- | ----------------------------------------------- | ----: | ---------: | -----: |
| GPT-5.6 Sol   | Frontier tier                                   | $5.00 |      $0.50 | $30.00 |
| GPT-5.6 Terra | Balance of intelligence and cost                | $2.00 |      $0.20 | $12.00 |
| GPT-5.4 mini  | High-volume coding, computer use, and subagents | $0.75 |     $0.075 |  $4.50 |
| GPT-5.6 Luna  | Cost-sensitive, high-volume tier                | $0.20 |      $0.02 |  $1.20 |

Anthropic standard text-token prices, captured 2026-08-17 from the
[Claude platform pricing page](https://platform.claude.com/docs/en/about-claude/pricing):

| Model            | Documented role                            |  Input | Cache read | Output |
| ---------------- | ------------------------------------------ | -----: | ---------: | -----: |
| Claude Fable 5   | Demanding reasoning and long-horizon work  | $10.00 |      $1.00 | $50.00 |
| Claude Opus 5    | Complex agentic coding and enterprise work |  $5.00 |      $0.50 | $25.00 |
| Claude Sonnet 5  | Balance of speed and intelligence          |  $2.00 |      $0.20 | $10.00 |
| Claude Haiku 4.5 | Fastest and most cost-effective            |  $1.00 |      $0.10 |  $5.00 |

Three properties of these tables control every figure in this guide:

- The Anthropic price vectors are exactly proportional on every token class.
  `Fable 5 : Opus 5 : Sonnet 5 : Haiku 4.5 = 10 : 5 : 2 : 1`. Therefore any
  Anthropic figure in this guide scales by that ratio, whatever the token mix
  is. Use this property to check the arithmetic.
- **Neither table contains a cache-write price, and both providers charge
  one.** An OpenAI explicit cache write costs 1.25 times the uncached-input
  price. An Anthropic cache write costs 1.25 times input for a 5-minute
  lifetime and 2 times input for a 1-hour lifetime. Every figure in this guide
  omits that line, so every figure understates the cost. See
  [Correction from measured usage](#correction-from-measured-usage) for the
  size of that error.
- **The GPT-5.6 Luna price is disputed.** The 2026-08-15 capture and a later
  live re-check of the model catalog, the comparison page, and the Luna page
  all gave $0.20 / $0.02 / $1.20. Official-domain search results crawled two
  weeks earlier gave $1.00 / $0.10 / $6.00, which is five times more. No
  invoice has settled it. That ratio is the five-times reserve this guide
  applies to every Luna figure.

In the 2026-08-17 capture, the Claude Sonnet 5 introductory price of
$2.00 / $10.00 is the standard price, and a previously scheduled increase to
$3.00 / $15.00 is no longer listed. An estimate built on the increase is about
50 percent too high.

## How this figure is calculated

Three inputs produce every number in the table above: a dated price book, an
estimated token rate, and the active hours in the period.

### Step 1 — select a token rate

The rate is the only estimated input. Two rates bound realistic agent work.
Both come from the workload profile, not from a measured ledger:

| Rate      | Per active hour: input / cache read / output | Derivation                                                       |
| --------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Steady    | 400K / 600K / 60K                            | 100K / 150K / 15K for each run, 15 minutes each run, 4 each hour |
| Saturated | 1M / 2M / 100K                               | 500K / 1M / 50K for each run, 30 minutes each run, 2 each hour   |

No observed provider record supplies these two rates. Every dollar figure in
this guide inherits that uncertainty.

### Step 2 — calculate the cost of one active agent-hour

Apply the price book to the selected rate. For Claude Opus 5 at the steady
rate:

```text
  400,000 input      × $5.00  / 1,000,000 = $2.00
+ 600,000 cache read × $0.50  / 1,000,000 = $0.30
+  60,000 output     × $25.00 / 1,000,000 = $1.50
                                            -----
                                            $3.80 per active agent-hour
```

The general form, with cache writes and reasoning, is in
[Calculate model cost once](#calculate-model-cost-once). The same calculation
for every model:

| Model            | Steady | Saturated |
| ---------------- | -----: | --------: |
| Claude Fable 5   |  $7.60 |    $17.00 |
| GPT-5.6 Sol      |  $4.10 |     $9.00 |
| Claude Opus 5    |  $3.80 |     $8.50 |
| GPT-5.6 Terra    |  $1.64 |     $3.60 |
| Claude Sonnet 5  |  $1.52 |     $3.40 |
| Claude Haiku 4.5 |  $0.76 |     $1.70 |
| GPT-5.4 mini     | $0.615 |     $1.35 |
| GPT-5.6 Luna     | $0.164 |     $0.36 |

### Step 3 — multiply by the active hours in the period

A non-stop agent is active for 24 hours on each day and 730 hours in each
month. For Claude Opus 5 at the steady rate:

```text
$3.80 × 24  =  $91.20 for one day
$3.80 × 730 =  $2,774 for one month
```

The table at the top of this guide applies these two multiplications to every
model.

## What this figure excludes

The table at the top of this guide is the model line only. The full equation
has five more terms. The prices quoted below come from the same 2026-08-17
Anthropic capture as the price book.

- **Cache writes.** See the price book above. This is the one excluded term
  with a measured size. See
  [Correction from measured usage](#correction-from-measured-usage).
- **Substrate.** A non-stop agent holds compute for all 730 hours. Add the
  hourly price of the node or pod. Claude Managed Agents prices this line
  directly at $0.08 for each session-hour, which is $58.40 for a non-stop
  month.
- **Tool fees.** Anthropic web search costs $10 for 1,000 searches. An agent
  that searches once each minute non-stop adds $438 each month.
- **Subagents.** A coordinator that runs subagents multiplies the token rate by
  its concurrency. These rates describe one serial thread.
- **Long-context and residency uplifts.** A GPT-5.6 request above 272,000 input
  tokens can cost more. Anthropic `inference_geo: "us"` adds 1.1 times.

## Correction from measured usage

One measured record exists, and it corrects the token mix that the estimate
assumes.

A single workstation retained 2,804 Claude Code session files covering 42
active days. Each assistant turn carries a `usage` object. Aggregating all
221,609 turns gives 45.84 billion tokens with this composition:

| Token class    | Assumed by the rates | Measured |
| -------------- | -------------------: | -------: |
| Uncached input |                 ~38% |    0.04% |
| Cache read     |                 ~57% |   96.76% |
| Cache write    |          0%, omitted |    2.82% |
| Output         |                  ~6% |    0.39% |

Two corrections follow:

1. **Uncached input is a rounding error.** Real agent work re-reads a cached
   prefix on almost every turn. A cost model weighted toward uncached input
   prices the wrong thing. Priced on Claude Opus 5, the measured mix costs
   about 4.7 times less for each token than the steady rate does.
2. **Cache writes are the second-largest cost line.** The 125,394 Claude Opus 5
   turns in this record used 24.51B cache-read, 703M cache-write, 86M output,
   and 2.08M uncached-input tokens. Priced on Claude Opus 5 and treating every
   cache write as a 5-minute write, that is $12,255 cache read, $4,397 cache
   write, $2,151 output, and $10 uncached input: 65, 23, 11, and 0.05 percent.
   A table that omits a line of that size reports about 77 percent of the model
   cost.

Correction 2 is worth about 1.3 times, and correction 1 about 4.7 times. Both
are smaller than the 25-times spread between model tiers, so model choice
remains the larger control. Neither correction transfers directly to the tables
above: the two rates assume no cache writes at all, so their cache-write error
is unknown rather than 23 percent.

This record measures one human driving agents interactively between 2026-07-05
and 2026-08-17. It does not measure a resident Deployment, and it is not a
provider invoice. Treat it as evidence about token composition, not as a price
for the non-stop case.

## Evidence class for each number

| Value                       | Class      | Basis                                                           |
| --------------------------- | ---------- | --------------------------------------------------------------- |
| Model prices                | Price book | Dated public captures, 2026-08-15 and 2026-08-17                |
| 730 hours in a month        | Convention | The [`730 / interval_hours` rule](#define-one-workload-profile) |
| The two token rates         | Estimated  | Workload profile assumptions, no ledger                         |
| Cost per hour and per month | Derived    | Price book times the estimated rate                             |
| Token-class composition     | Measured   | 221,609 assistant turns over 42 days                            |
| GPT-5.6 Luna price          | Disputed   | $0.20 / $0.02 / $1.20 against $1.00 / $0.10 / $6.00, no invoice |
| Substrate and tool prices   | Price book | The 2026-08-17 Anthropic capture                                |
| Every other excluded term   | Unknown    | Not zero                                                        |

A price-book calculation is not an observed provider charge. An unknown value
is not zero.

## Cost boundary

Use one workload profile for every execution surface. Change only the substrate
inputs when you compare a local run, GitHub Actions, a scheduled Kubernetes
Job, or a resident Deployment. Use this equation:

```text
monthly cost =
  fixed substrate cost
  + runs × (model + tools + variable compute)
  + storage
  + network
```

The terms mean:

| Term             | Include                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| Fixed substrate  | Compute that accrues while no run is active. A resident Deployment is the usual case. |
| Runs             | Every initial attempt, retry, and delegated run in the month.                         |
| Model            | Input, cache-read, cache-write, output, and reasoning charges for one run.            |
| Tools            | Search, browser, image, sandbox, or other billable tool use for one run.              |
| Variable compute | Runner minutes or Job resources that accrue only while a run is active.               |
| Storage          | Session data, artifacts, logs, volumes, and backups.                                  |
| Network          | Egress, gateways, and other billed transfer.                                          |

An included quota changes the billed amount. It does not change usage. Record
the usage before you apply the quota.

## Define one workload profile

Enter these values once:

| Input                           | Unit             | Rule                                                               |
| ------------------------------- | ---------------- | ------------------------------------------------------------------ |
| Workload identity               | stable text      | Use the same identity on every surface.                            |
| Interval                        | hours            | Use the time between scheduled starts.                             |
| Attempts per scheduled start    | count            | Include the first attempt and expected retries.                    |
| Delegated runs per attempt      | count            | Count each subagent or delegated Job separately.                   |
| Input tokens                    | tokens per run   | Keep uncached input separate from cache reads.                     |
| Cache-read tokens               | tokens per run   | Use `null`, not zero, when the provider does not report them.      |
| Cache-write tokens              | tokens per run   | Use `null`, not zero, when the provider does not report them.      |
| Output tokens                   | tokens per run   | Keep reasoning separate when the provider reports it separately.   |
| Reasoning tokens                | tokens per run   | Use the provider's billing rule. Do not assume that they are free. |
| Billable tools                  | quantity per run | Name each unit and price source.                                   |
| Active duration                 | minutes per run  | Use this for variable compute.                                     |
| Artifacts, storage, and network | provider units   | Keep each provider line separate.                                  |

Convert an interval to an average month with:

```text
runs per month = 730 / interval_hours
```

For example, one run every 24 hours gives `730 / 24 = 30.4167` scheduled
starts in an average month. A calendar-month report can use the actual count
instead. Label which method you use.

Then calculate the total attempt count:

```text
attempts per month =
  scheduled starts
  × attempts per scheduled start
  × (1 + delegated runs per attempt)
```

Use the last factor only when every attempt creates that number of delegated
runs. If delegation varies, list the parent and child workloads separately.

## Calculate model cost once

Use a price book with a source and an effective date. For a model with separate
text-token prices:

```text
model cost per run =
  input_tokens × input_price / 1,000,000
  + cache_read_tokens × cache_read_price / 1,000,000
  + cache_write_tokens × cache_write_price / 1,000,000
  + output_tokens × output_price / 1,000,000
  + provider-defined reasoning cost
```

The same workload profile and price book MUST produce the same model line on
every execution surface. Do not recalculate model cost inside an Actions or
Kubernetes estimate.

Keep two cost fields when evidence is available:

- **Provider-reported cost** is the charge that the provider returned for the
  exchange. Keep its amount and currency unchanged.
- **Price-book estimate** is a derived amount. Keep the source and effective
  date with it.

Do not replace one with the other. Do not present a derived estimate as an
observed provider charge.

## Worked case: one organization report each day

The example starts from an observed AI Outfitter organization-report flow. The
2026-W32 report covered 16 repositories. Its KPI JSON was 21,020 bytes. Its
rendered Markdown was 11,719 bytes. Scripts collected and rendered the facts.
The model wrote only a short Highlights paragraph.

Those report dimensions are observed. The retained artifacts do not contain a
token total. Therefore, these token bands are estimated:

| Band     |   Input | Cache read | Output | Total per run |
| -------- | ------: | ---------: | -----: | ------------: |
| Compact  |  10,000 |     20,000 |  2,000 |        32,000 |
| Expected |  25,000 |     75,000 |  5,000 |       105,000 |
| High     | 100,000 |    300,000 | 15,000 |       415,000 |

All values use the OpenAI half of the [price book](#price-book) above. Keep the
base estimate and the five-times Luna reserve separate.

At `730 / 24 = 30.4167` runs per month, the model estimates are:

| Band     | Monthly tokens | GPT-5.6 Sol | GPT-5.6 Terra | GPT-5.6 Luna | GPT-5.4 mini |
| -------- | -------------: | ----------: | ------------: | -----------: | -----------: |
| Compact  |         0.973M |       $3.65 |         $1.46 |        $0.15 |        $0.55 |
| Expected |         3.194M |       $9.51 |         $3.80 |        $0.38 |        $1.43 |
| High     |        12.623M |      $33.46 |        $13.38 |        $1.34 |        $5.02 |

The expected model cost is $0.313 for each run on Sol, $0.125 on Terra,
$0.013 on Luna, and $0.047 on GPT-5.4 mini. The five-times Luna reserve changes
its expected monthly planning line from $0.38 to $1.90.

These values exclude everything in
[What this figure excludes](#what-this-figure-excludes), and also tax.

This case sits far below the non-stop ceiling at the top of this guide, because
the model writes one paragraph and scripts do the rest.

## Compare execution surfaces

Start with the same expected daily-report model line. Then add only the
surface-specific substrate.

| Surface                        | Fixed substrate                                                 | Variable compute                                                |
| ------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| GitHub-hosted Actions          | none for an otherwise idle workload                             | billable runner minutes after included quotas                   |
| Self-hosted Actions            | allocated runner and operations cost                            | per-run cost when your allocation method charges it             |
| Local run                      | allocated workstation cost, if the organization accounts for it | active process time, if the organization accounts for it        |
| Scheduled Kubernetes Job       | none when no workload-specific capacity stays allocated         | pod resource time for every attempt                             |
| Delegated Kubernetes Job       | none when no workload-specific capacity stays allocated         | child pod resource time, recorded under its parent run          |
| Resident Kubernetes Deployment | allocated resources for 730 hours                               | extra per-run resources that are not in the resident allocation |

This gives two different substrate equations for the same model line:

```text
Actions monthly cost =
  model and tool cost for all attempts
  + hosted billable minutes × hosted runner price
  + self-hosted runner allocation
  + storage
  + network
```

```text
Resident monthly cost =
  resident hourly allocation × 730
  + model and tool cost for all attempts
  + storage
  + network
```

An idle resident has zero model cost when it makes no model exchange. It still
has its 730-hour substrate allocation. A scheduled Job has no workload-specific
compute cost while no pod exists, unless the cluster allocation method assigns
idle capacity to it.

See the [Actions billing-inputs research note](https://github.com/ai-outfitter/actions/blob/main/docs/research/inference-pricing.md)
for the runner-minute form. The
[Agent Operator](https://github.com/ai-outfitter/agent-operator) resident and
Job forms are not documented yet.

## Retries, failures, and subagents

Count every attempt once. A failed attempt can incur model, tool, runner, and
network costs even when it produces no artifact. A retry MUST use a new attempt
number. Do not overwrite or hide the first attempt.

A delegated run MUST carry its parent run. Add the child cost once to the
workload total. Do not also copy the child model exchanges into the parent's
direct model line.

If a workflow platform retries a whole job, record that job as a new attempt.
If a harness retries one provider request inside the same attempt, record each
model exchange and aggregate them once into that attempt.

## Unknown and partial usage

Use these states:

| State         | Meaning                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `complete`    | The record contains all usage fields that the provider and harness expose. It has no declared gap. |
| `partial`     | The record contains some usage fields and lists each unavailable field.                            |
| `unavailable` | The record contains no usable usage counters and lists the gap.                                    |

Use `null` for an unavailable counter. Use `0` only when the provider or
harness observed zero. A monthly view MUST render unavailable cost as unknown.
It MUST NOT render it as `$0`.

Do not compare two totals until their boundaries match. State whether each
total includes retries, delegated runs, tools, storage, network, quotas, and
tax.

## Replace estimates with measurements

Retain one machine-readable record for each run and model exchange. After 30
measured daily reports, replace the planning bands with the median, 90th
percentile, and maximum successful-run cost. Report failed attempts and retries
separately.

Only one execution surface can supply that record today:

| Surface                 | Usage record                               | Status      |
| ----------------------- | ------------------------------------------ | ----------- |
| Local Claude Code       | One `usage` object for each assistant turn | Available   |
| Local `codex`           | The rollout file carries no token field    | Unavailable |
| Agent Operator resident | The Pi session file carries no token field | Unavailable |
| GitHub Actions run      | An HTML transcript artifact, with no total | Unavailable |

Therefore a comparison across surfaces is not possible yet. Close this gap
before you replace any estimate above. Two proposals do it:
[Pensieve pull request #22](https://github.com/ai-outfitter/pensieve/pull/22)
for the record contract, and
[Actions pull request #42](https://github.com/ai-outfitter/actions/pull/42)
for the runner-minute inputs. Neither is merged.

This guide defines the method and the record contract. It does not include a
collector, a calculator command, or a billing dashboard.
