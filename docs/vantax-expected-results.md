# VantaX Catalyst Expected Results v3 — Post-Fix (PR #157)

> All results traced from actual seed data + actual reconciliation/validation engine code after PR #157 column-name fixes.

---

## How to Use This Document

For each sub-catalyst below, you'll see:
1. **VantaX Seed Name** — the name shown in the VantaX demo on the Catalysts page
2. **Atheon Template Name** — the corresponding standard sub-catalyst name from Atheon's template system (`catalyst-templates.ts`)
3. **Where to run it** — which cluster and sub-catalyst to click on in the Catalysts page
4. **Expected results** — exact numbers you should see after execution

---

## Sub-Catalyst Name Mapping (VantaX → Atheon)

| # | VantaX Seed Name (what you see) | Atheon Template Name (standard name) | Cluster | Mode |
|---|---|---|---|---|
| 1 | GR/IR Reconciliation | **Invoice Reconciliation** | Finance | reconciliation |
| 2 | AP Invoice Validation | **Accounts Payable** | Finance | validation |
| 3 | Bank Reconciliation | **Reconciliation** | Finance | reconciliation |
| 4 | Inventory Reconciliation | **Inventory Management** | Supply Chain | reconciliation |
| 5 | PO-to-GR Matching | **PO Automation** | Supply Chain | reconciliation |
| 6 | Supplier Validation | **Supplier Scoring** | Supply Chain | validation |
| 7 | Revenue Recognition | **Revenue Recognition** *(same name)* | Revenue | validation |
| 8 | Customer Receivables | **Accounts Receivable** | Revenue | validation |
| 9 | Sales Order Matching | **Order Processing** | Revenue | reconciliation |

---

## Seed Data Summary (353 ERP Records)

| Table | Records | Key Fields |
|---|---|---|
| `erp_invoices` | 80 | invoice_number, invoice_date, **total**, reference |
| `erp_purchase_orders` | 80 | po_number, **total**, delivery_status, reference |
| `erp_bank_transactions` | 80 | reference, **debit**, **credit**, reconciled |
| `erp_suppliers` | 15 | name, vat_number, contact_email |
| `erp_customers` | 20 | name, **credit_limit**, **credit_balance** |
| `erp_products` | 18 | sku, **stock_on_hand**, **cost_price** |
| `erp_gl_accounts` | 20 | account_code, balance |
| `erp_journal_entries` | 40 | journal_number, journal_date, **total_debit** |

### Deliberate Data Quality Mix

**Purchase Orders vs Invoices:**
- PO 1-65 (81.25%): Exact amount match with invoices
- PO 66-72 (8.75%): Price variance 3-7% from invoice
- PO 73-80 (10%): `reference = null` (no matching invoice)

**Bank Transactions:**
- Tx 1-55 (68.75%): Match paid invoices (reference = SAP-INV-*)
- Tx 56-65 (12.5%): Bank fees (reference = BNK-FEE-*)
- Tx 66-80 (18.75%): Unreconciled EFT payments (reference = EFT-*)

**PO Delivery Status:**
- 54 received (67.5%), 13 partial (16.25%), 13 pending (16.25%)

---

## FINANCE CLUSTER

### 1. GR/IR Reconciliation = Atheon: **Invoice Reconciliation**

**Run:** Catalysts > Finance > GR/IR Reconciliation > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **72** | 80 POs minus 8 skipped (null reference) |
| total_records_target | **80** | All 80 invoices |
| matched | **72** | All non-skipped POs match an invoice by reference to invoice_number |
| discrepancies | **7** | POs 66-72: 3-7% price variance exceeds 0.01 tolerance |
| unmatched_source | **0** | All 72 attempted matches succeed |
| unmatched_target | **8** | Invoices 73-80 have no matching PO |
| status | **partial** | Discrepancies + unmatched targets |

**Data:** PO `reference` to Invoice `invoice_number` (exact), PO `total` to Invoice `total` (tolerance 0.01)

---

### 2. AP Invoice Validation = Atheon: **Accounts Payable**

**Run:** Catalysts > Finance > AP Invoice Validation > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **80** | All 80 invoices |
| matched (valid) | **80** | All pass: total present, invoice_date present, invoice_number present |
| discrepancies (issues) | **0** | No missing fields |
| status | **completed** | 0 issues |

**Data:** Invoice table via `accounts_payable` module. All fields present after PR #157 fix.

---

### 3. Bank Reconciliation = Atheon: **Reconciliation**

**Run:** Catalysts > Finance > Bank Reconciliation > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **80** | All bank tx have non-empty reference |
| total_records_target | **80** | All invoices |
| matched | **55** | Tx 1-55 match by reference containing invoice number |
| discrepancies | **0** | Matched amounts identical (same seed values) |
| unmatched_source | **25** | 10 bank fees + 15 EFT payments |
| unmatched_target | **25** | Invoices 56-80 not matched |
| status | **partial** | Unmatched records exist |

**Data:** Bank `reference` to Invoice `invoice_number` (**contains** match), Bank `credit` to Invoice `total` (tolerance 0.50)

---

### Finance Cluster Summary

| VantaX Name | Atheon Name | Matched | Issues | Rate |
|---|---|---|---|---|
| GR/IR Reconciliation | Invoice Reconciliation | 72/72 | 7 price variances | 90.3% |
| AP Invoice Validation | Accounts Payable | 80/80 valid | 0 | 100% |
| Bank Reconciliation | Reconciliation | 55/80 | 25 unmatched | 68.75% |

---

## SUPPLY CHAIN CLUSTER

### 4. Inventory Reconciliation = Atheon: **Inventory Management**

**Run:** Catalysts > Supply Chain > Inventory Reconciliation > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **18** | 18 products |
| total_records_target | **18** | Same 18 products (same table queried twice) |
| matched | **18** | All SKUs match |
| discrepancies | **0** | Identical stock values |
| status | **completed** | Perfect match |

**Data:** Products `sku` to `sku` (exact), `stock_on_hand` to `stock_on_hand` (tolerance 1)

---

### 5. PO-to-GR Matching = Atheon: **PO Automation**

**Run:** Catalysts > Supply Chain > PO-to-GR Matching > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **80** | All POs |
| total_records_target | **67** | 54 received + 13 partial (excludes 13 pending) |
| matched | **67** | All GR po_numbers found in source |
| discrepancies | **0** | Same table, identical totals |
| unmatched_source | **13** | 13 POs with pending delivery |
| unmatched_target | **0** | All GRs matched |
| status | **partial** | Unmatched source records |

**Data:** PO `po_number` to GR `po_number` (exact), PO `total` to GR `total` (tolerance 0.01)

---

### 6. Supplier Validation = Atheon: **Supplier Scoring**

**Run:** Catalysts > Supply Chain > Supplier Validation > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **15** | 15 suppliers |
| matched (valid) | **0** | All fail: no monetary field in supplier SELECT |
| discrepancies (issues) | **15** | "Missing required field: amount/total" |
| status | **partial** | 15 issues |

**Data:** Supplier table has id, name, vat_number, etc. but no amount/total/credit_limit/debit/credit/cost_price fields selected.

---

### Supply Chain Cluster Summary

| VantaX Name | Atheon Name | Matched | Issues | Rate |
|---|---|---|---|---|
| Inventory Reconciliation | Inventory Management | 18/18 | 0 | 100% |
| PO-to-GR Matching | PO Automation | 67/80 | 13 unmatched | 83.75% |
| Supplier Validation | Supplier Scoring | 0/15 valid | 15 (no monetary) | 0% |

---

## REVENUE CLUSTER

### 7. Revenue Recognition = Atheon: **Revenue Recognition** *(same name)*

**Run:** Catalysts > Revenue > Revenue Recognition > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **20** | 20 customers (via `accounts_receivable` module) |
| matched (valid) | **0** | All fail: no date field on customers |
| discrepancies (issues) | **20** | "Missing required field: date" |
| status | **partial** | 20 issues |

**Data:** Customer table has credit_limit (passes hasAmount) and name/id (passes hasRef) but NO date field.

---

### 8. Customer Receivables = Atheon: **Accounts Receivable**

**Run:** Catalysts > Revenue > Customer Receivables > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **20** | 20 customers (via `customer` module) |
| matched (valid) | **0** | All fail: no date field |
| discrepancies (issues) | **20** | "Missing required field: date" |
| status | **partial** | 20 issues |

**Data:** Same customer table, same result as Revenue Recognition.

---

### 9. Sales Order Matching = Atheon: **Order Processing**

**Run:** Catalysts > Revenue > Sales Order Matching > Execute

| Metric | Expected Value | Why |
|---|---|---|
| total_records_source | **80** | 80 invoices |
| total_records_target | **80** | Same 80 invoices (same table queried twice) |
| matched | **80** | All invoice_numbers match |
| discrepancies | **0** | Identical totals |
| status | **completed** | Perfect match |

**Data:** Invoice `invoice_number` to Invoice `invoice_number` (exact), `total` to `total` (tolerance 0.01)

---

### Revenue Cluster Summary

| VantaX Name | Atheon Name | Matched | Issues | Rate |
|---|---|---|---|---|
| Revenue Recognition | Revenue Recognition | 0/20 valid | 20 (no date) | 0% |
| Customer Receivables | Accounts Receivable | 0/20 valid | 20 (no date) | 0% |
| Sales Order Matching | Order Processing | 80/80 | 0 | 100% |

---

## FULL SUMMARY

| # | VantaX Name | Atheon Name | Cluster | Src | Tgt | Matched | Issues | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | GR/IR Reconciliation | **Invoice Reconciliation** | Finance | 72 | 80 | 72 | 7 | partial |
| 2 | AP Invoice Validation | **Accounts Payable** | Finance | 80 | - | 80 | 0 | completed |
| 3 | Bank Reconciliation | **Reconciliation** | Finance | 80 | 80 | 55 | 0 | partial |
| 4 | Inventory Reconciliation | **Inventory Management** | Supply Chain | 18 | 18 | 18 | 0 | completed |
| 5 | PO-to-GR Matching | **PO Automation** | Supply Chain | 80 | 67 | 67 | 0 | partial |
| 6 | Supplier Validation | **Supplier Scoring** | Supply Chain | 15 | - | 0 | 15 | partial |
| 7 | Revenue Recognition | **Revenue Recognition** | Revenue | 20 | - | 0 | 20 | partial |
| 8 | Customer Receivables | **Accounts Receivable** | Revenue | 20 | - | 0 | 20 | partial |
| 9 | Sales Order Matching | **Order Processing** | Revenue | 80 | 80 | 80 | 0 | completed |

**3 completed (100%):** AP Invoice Validation, Inventory Reconciliation, Sales Order Matching
**3 real data issues:** GR/IR (7 price variances), Bank Rec (25 unmatched), PO-to-GR (13 pending)
**3 master data flags:** Supplier Scoring (no monetary), Revenue Recognition (no date), Accounts Receivable (no date)

---

## CUMULATIVE SCENARIOS

### Scenario A: Finance Only (3 sub-catalysts)
- Health dimension: `financial` updated
- 3 catalyst runs recorded
- Risk alerts: Bank Rec 68.75% triggers alert

### Scenario B: Finance + Supply Chain (6 sub-catalysts)
- Health dimensions: `financial` + `operational` updated
- 6 catalyst runs total
- Additional alerts: Supplier Scoring 0%, PO Automation 83.75%

### Scenario C: All 3 Clusters (9 sub-catalysts)
- Health dimensions: `financial` + `operational` + `revenue` updated
- 9 catalyst runs total
- Full Pulse/Apex/Dashboard populated
