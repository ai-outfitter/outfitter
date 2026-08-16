# Estimate agent workload cost

Use one workload profile for every execution surface. Change only the substrate
inputs when you compare a local run, GitHub Actions, a scheduled Kubernetes
Job, or a resident Deployment.

This guide calculates a planning estimate. It does not read invoices or collect
usage. [Pensieve's usage-accounting requirements](https://github.com/ai-outfitter/pensieve/blob/main/docs/requirements/SRV-001-evidence-sink.md#srv-00113-usage-accounting-records)
define the evidence that can replace each estimate later.

## Cost boundary

Use this equation:

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

Those report dimensions are **observed**. The retained artifacts do not contain
a token total. Therefore, these token bands are **estimated**:

| Band     |   Input | Cache read | Output | Total per run |
| -------- | ------: | ---------: | -----: | ------------: |
| Compact  |  10,000 |     20,000 |  2,000 |        32,000 |
| Expected |  25,000 |     75,000 |  5,000 |       105,000 |
| High     | 100,000 |    300,000 | 15,000 |       415,000 |

All values use the [OpenAI standard text-token price book](https://developers.openai.com/api/docs/models)
captured on **2026-08-15**. Prices are United States dollars per one million
tokens:

| Model         | Input | Cache read | Output |
| ------------- | ----: | ---------: | -----: |
| GPT-5.6 Sol   | $5.00 |      $0.50 | $30.00 |
| GPT-5.6 Terra | $2.00 |      $0.20 | $12.00 |
| GPT-5.6 Luna  | $0.20 |      $0.02 |  $1.20 |
| GPT-5.4 mini  | $0.75 |     $0.075 |  $4.50 |

The source snapshot records a five-times planning reserve for GPT-5.6 Luna
because older official search results showed a higher price. Keep the base
estimate and reserve separate.

At `730 / 24 = 30.4167` runs per month, the model estimates are:

| Band     | Monthly tokens | GPT-5.6 Sol | GPT-5.6 Terra | GPT-5.6 Luna | GPT-5.4 mini |
| -------- | -------------: | ----------: | ------------: | -----------: | -----------: |
| Compact  |         0.973M |       $3.65 |         $1.46 |        $0.15 |        $0.55 |
| Expected |         3.194M |       $9.51 |         $3.80 |        $0.38 |        $1.43 |
| High     |        12.623M |      $33.46 |        $13.38 |        $1.34 |        $5.02 |

The expected model cost is $0.3125 per run on Sol, $0.125 on Terra,
$0.0125 on Luna, and $0.046875 on GPT-5.4 mini. The five-times Luna reserve
changes its expected monthly planning line from $0.38 to $1.90.

These values exclude cache writes, paid tools, long-context uplifts, regional
processing, tax, storage, network, and compute. Unknown excluded usage is not
zero.

The [organization wiki synthesis](https://github.com/ai-outfitter/wiki/blob/main/syntheses/agent-workload-cost-model.md)
records the evidence, assumptions, and calculation limits.

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

See the [Actions billing inputs](https://github.com/ai-outfitter/actions/blob/main/docs/research/inference-pricing.md)
and [Agent Operator cost guidance](https://github.com/ai-outfitter/agent-operator#estimate-workload-cost)
for the surface-specific forms.

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

This milestone defines the method and record contract. It does not provide a
collector, calculator command, calculator interface, or billing dashboard.
