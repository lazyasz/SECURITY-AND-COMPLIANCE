import os
import json
import time
import random
import threading
from datetime import datetime
from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
from models import PatientRecord, ConsentRegistry, AuditLog
from encryption import encrypt_field

# Create tables on start
Base.metadata.create_all(bind=engine)

SYNTHETIC_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "synthetic_records.json"
)

class IngestionPipeline:
    def __init__(self):
        self._running = False
        self._thread = None
        self.records_ingested = 0
        self.total_processed = 0
        self.current_status = "IDLE"
        self._lock = threading.Lock()

    def load_raw_dataset(self):
        """Loads records from the synthetic data json."""
        if not os.path.exists(SYNTHETIC_DATA_PATH):
            return []
        try:
            with open(SYNTHETIC_DATA_PATH, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading synthetic dataset: {e}")
            return []

    def start(self):
        with self._lock:
            if self._running:
                return False
            self._running = True
            self.current_status = "RUNNING"
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            return True

    def stop(self):
        with self._lock:
            if not self._running:
                return False
            self._running = False
            self.current_status = "STOPPED"
            return True

    def reset_db(self):
        """Wipe database records to let the user re-run the demo from scratch."""
        db = SessionLocal()
        try:
            db.query(PatientRecord).delete()
            db.query(ConsentRegistry).delete()
            db.query(AuditLog).delete()
            db.commit()
            
            self.records_ingested = 0
            self.total_processed = 0
            self.current_status = "IDLE"
            
            # Log the database wipe
            wipe_log = AuditLog(
                timestamp=datetime.utcnow(),
                username="admin_user",
                role="Admin",
                action="WIPE_DATABASE",
                resource="System Database",
                reason="Manual system reset for compliance demo",
                status="SUCCESS"
            )
            db.add(wipe_log)
            db.commit()
            return True
        except Exception as e:
            db.rollback()
            print(f"Error wiping database: {e}")
            return False
        finally:
            db.close()

    def seed_initial_data(self):
        """Seed a few records instantly so the UI has contents without starting the pipeline."""
        raw_records = self.load_raw_dataset()
        if not raw_records:
            return
        
        db = SessionLocal()
        try:
            # Check if database is already populated
            if db.query(PatientRecord).count() > 0:
                return
            
            # Seed first 3 records immediately
            for record in raw_records[:3]:
                self._ingest_single_record(db, record)
            print("Successfully pre-seeded 3 database records.")
        except Exception as e:
            print(f"Error pre-seeding database: {e}")
        finally:
            db.close()

    def _ingest_single_record(self, db: Session, record: dict):
        """Process, encrypt, and store a single patient record."""
        # 1. Register Consent first (GDPR Art. 7 compliance)
        # Check if consent registry already has this user
        email = record["email"]
        consent = db.query(ConsentRegistry).filter(ConsentRegistry.email == email).first()
        if not consent:
            consent = ConsentRegistry(
                email=email,
                consent_marketing=record.get("consent_marketing", False),
                consent_research=record.get("consent_research", False),
                consent_share=record.get("consent_share", False),
                updated_at=datetime.utcnow()
            )
            db.add(consent)
            db.flush()  # gets the ID

        # 2. Encrypt PII/PHI Fields at-rest
        # For demonstration, we encrypt at-rest fields using AES/Fernet
        new_patient = PatientRecord(
            first_name_encrypted=encrypt_field(record["first_name"]),
            last_name_encrypted=encrypt_field(record["last_name"]),
            email_encrypted=encrypt_field(record["email"]),
            phone_encrypted=encrypt_field(record["phone"]),
            ssn_encrypted=encrypt_field(record["ssn"]),
            birth_date_encrypted=encrypt_field(record["birth_date"]),
            diagnosis_encrypted=encrypt_field(record["diagnosis"]),
            treatment_encrypted=encrypt_field(record["treatment"]),
            billing_amount_encrypted=encrypt_field(str(record["billing_amount"])),
            gender=record["gender"],
            country=record["country"],
            consent_marketing=consent.consent_marketing,
            consent_research=consent.consent_research,
            consent_share=consent.consent_share,
            ingested_at=datetime.utcnow()
        )
        
        db.add(new_patient)
        db.flush()
        
        # Connect consent to patient record ID
        consent.patient_id = new_patient.id
        
        # 3. Create Audit Log (HIPAA Audit Controls & GDPR Accountability)
        audit_log = AuditLog(
            timestamp=datetime.utcnow(),
            username="SYSTEM_PIPELINE",
            role="System",
            action="INGEST_DATA",
            resource=f"Patient ID: {new_patient.id}",
            reason="Automated ETL spark ingestion & column-encryption pipeline",
            status="SUCCESS"
        )
        db.add(audit_log)
        db.commit()
        
        self.records_ingested += 1

    def _run_loop(self):
        raw_records = self.load_raw_dataset()
        if not raw_records:
            self._running = False
            self.current_status = "ERROR: No Synthetic Data found"
            return

        db = SessionLocal()
        try:
            while self._running:
                # Select a random record to ingest
                record = random.choice(raw_records)
                
                # Check if this email is already ingested in this run to keep DB realistic
                # If already ingested, we'll still ingest it but simulate it as a new transaction
                self._ingest_single_record(db, record)
                self.total_processed += 1
                
                # Wait between 3 to 6 seconds for streaming visualization effect
                time.sleep(random.uniform(3.0, 5.0))
        except Exception as e:
            print(f"Exception in ingestion loop: {e}")
            self.current_status = f"ERROR: {str(e)}"
            self._running = False
        finally:
            db.close()

# Singleton pipeline instance
pipeline_instance = IngestionPipeline()
