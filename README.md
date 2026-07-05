# SecureData Compliance Framework

SecureData Compliance Framework is a mock Big Data security dashboard designed to demonstrate compliance engineering controls aligned with GDPR (Articles 6, 7, 17, 32) and HIPAA Privacy/Security rules.

It features a column-level encrypted database at-rest, dynamic data masking filters based on user roles, active consent registries, right-to-erasure workflows, and a central security audit ledger.

---

## 1. Tech Stack & Rationale

- **Backend**: **FastAPI (Python)**. Chosen for its clean API routing, native dependency injection (ideal for role validations), and lightweight footprint.
- **Database / Data Lake**: **SQLite** via **SQLAlchemy**. Offers zero-configuration database access out-of-the-box, ensuring immediate portability for reviewers without requiring Docker or PostgreSQL servers.
- **Cryptography**: **Python Cryptography (Fernet / AES-256)**. Provides high-security symmetric field-level encryption for storage rows.
- **Frontend / Dashboard**: **Single-Page App (HTML5 / CSS3 / ES6 Javascript)**. Bypasses the need for Node.js or NPM version setups by running directly as static files hosted by the FastAPI backend on a single port (`8000`). This completely resolves CORS conflicts and makes setup simple.

---

## 2. Ingestion & Security Architecture

The following flow represents the data security pipelines:

```
                  ┌──────────────────────────────────────────┐
                  │          Ingestion Source (JSON)         │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ▼ (Mock Kafka Stream)
                  ┌──────────────────────────────────────────┐
                  │            Pipeline Ingest               │
                  └────────────────────┬─────────────────────┘
                                       │
                                       ├──────────────────────────────┐
                                       ▼ (Consent Verification)       ▼ (Field-Level AES-256 Crypt)
                  ┌──────────────────────────────────────────┐ ┌──────────────────────────────────────────┐
                  │             Consent Registry             │ │           Cryptographic Engine           │
                  └────────────────────┬─────────────────────┘ └──────────────────┬───────────────────────
                                       │                                          │
                                       ▼                                          ▼ (SQL Write)
                  ┌──────────────────────────────────────────────────────────────────────────────────┐
                  │                            SQLite Database Storage Tables                        │
                  └────────────────────────────────────┬─────────────────────────────────────────────┘
                                                       │
                                                       ▼ (API Access Layer with RBAC Filters)
                                            ┌─────────────────────┐
                                            │  FastAPI Web Server │
                                            └──────────┬──────────┘
                                                       │
                        ┌──────────────────────────────┼──────────────────────────────┐
                        ▼                              ▼                              ▼
             ┌─────────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐
             │    Analyst Role     │        │    Auditor Role     │        │     Admin Role      │
             │   (Masked Views)    │        │ (Masked Views+Logs) │        │ (Break-Glass Decrypt)│
             └─────────────────────┘        └─────────────────────┘        └─────────────────────┘
```

---

## 3. Local Setup Instructions

Ensure you have **Python 3.8+** installed. No Node.js or NPM package setups are required.

### Step 1: Install Dependencies
Open a terminal in the project directory and install the required Python libraries:
```bash
pip install fastapi uvicorn sqlalchemy cryptography
```

### Step 2: Launch the Framework Server
Change directory to the `/backend` folder and run the FastAPI server:
```bash
cd backend
python main.py
```
*Note: Alternatively, run: `uvicorn main:app --reload --port 8000` from the backend directory.*

### Step 3: Open the Dashboard
Navigate your web browser to:
```url
http://127.0.0.1:8000
```
The application will automatically pre-seed initial records, and you will see the active dashboard immediately.

---

## 4. Live Walk-Through Script (Under 5 Minutes)

Use this guide to demonstrate the technical compliance controls step-by-step:

### 1. Ingest Streaming Records (Overview)
- **Action**: On the **Overview** dashboard, click **Start Streaming Ingestion**.
- **Observation**: The status indicator turns green (`RUNNING`). Ingestion metrics count up, and the connector lines animate to represent streaming data. Click **Stop Stream** after 10-15 seconds.

### 2. Verify Dynamic Data Masking (Data Explorer & Analyst Role)
- **Action**: Make sure the active role in the topbar is set to **Analyst (Default)** and navigate to the **Data Explorer** panel.
- **Observation**: Review the dataset table. Observe that PII fields are masked: names are pseudonymized (e.g. `Patient_C89B`), emails are obfuscated (`e***@example.com`), SSNs are redacted, and birth dates display the birth year only.
- **Consent Rule Check**: Scroll to records that do not have research consent. Notice that the *Diagnosis* and *Treatment* fields display as `[RESTRICTED - NO RESEARCH CONSENT]`, illustrating consent-driven column filtering.

### 3. Adjust GDPR Consents (Consent Registry)
- **Action**: Go to the **Consent Registry** page. Pick any subject, and toggle the **Medical Research (Clinical Analytics)** switch.
- **Action**: Go back to the **Data Explorer** page.
- **Observation**: Find the record you updated. The *Diagnosis* field will immediately switch between restricted block message and the masked clinical term based on your choice.

### 4. Admin Decryption Break-Glass (Admin Role)
- **Action**: In the top-right role dropdown, change the session role to **System Administrator**.
- **Action**: Go to the **Data Explorer** view. Note that an orange **Emergency Break-Glass Decryption** bar is now visible.
- **Action**: Try to slide the toggle without entering text. The system blocks the override, requiring a compliance justification.
- **Action**: Enter a justification (e.g. `Emergency clinical review: patient emergency`) in the text field, then slide the toggle.
- **Observation**: The table instantly refreshes to display raw, decrypted data values for all PII and PHI columns.

### 5. Access Security Logs (Auditor Role)
- **Action**: Change the active role in the top-right to **Compliance Auditor** and navigate to the **Audit Trail** page.
- **Observation**: View the chronological access ledger. Note the logged entry with action `READ_PATIENTS_DECRYPTED` showing the administrator username (`admin_user`), the exact timestamp, and the justification text entered during the break-glass.
- **Action**: Switch back to **Analyst** role. Try to view the Audit Trail page. Access is blocked by the RBAC middleware and logged as a denied event.

### 6. Trigger GDPR Article 17 Erasure (Right to Erasure)
- **Action**: Switch the role back to **System Administrator** and open the **Right to Erasure** tab.
- **Action**: Click the red **Erase Data** button next to a patient. Approve the browser confirmation dialog.
- **Observation**: The record is removed from the active storage lists. Switch to **Auditor** role, open the **Audit Trail**, and observe the new entry showing the successful deletion event `ERASE_PATIENT_GDPR_ART17` for that record ID.
