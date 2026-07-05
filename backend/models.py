import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey
from sqlalchemy.orm import relationship
from database import Base

class PatientRecord(Base):
    __tablename__ = "patient_records"

    id = Column(Integer, primary_key=True, index=True)
    
    # Encrypted fields (PII/PHI) stored as encrypted strings
    first_name_encrypted = Column(String, nullable=True)
    last_name_encrypted = Column(String, nullable=True)
    email_encrypted = Column(String, nullable=True)
    phone_encrypted = Column(String, nullable=True)
    ssn_encrypted = Column(String, nullable=True)
    birth_date_encrypted = Column(String, nullable=True)
    diagnosis_encrypted = Column(String, nullable=True)
    treatment_encrypted = Column(String, nullable=True)
    billing_amount_encrypted = Column(String, nullable=True)
    
    # Plaintext fields (Non-identifying or metadata)
    gender = Column(String, nullable=True)
    country = Column(String, nullable=True)
    
    # Consent state (GDPR Art. 7)
    consent_marketing = Column(Boolean, default=False)
    consent_research = Column(Boolean, default=False)
    consent_share = Column(Boolean, default=False)
    
    # Auditing / Retention tracking
    ingested_at = Column(DateTime, default=datetime.datetime.utcnow)
    erased_at = Column(DateTime, nullable=True)  # Timestamp if patient exercised GDPR Art. 17 "Right to Erasure"


class ConsentRegistry(Base):
    __tablename__ = "consent_registry"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, nullable=True)  # Links to patient record if it exists
    email = Column(String, unique=True, index=True)  # Unique identifier for consent mapping
    consent_marketing = Column(Boolean, default=False)
    consent_research = Column(Boolean, default=False)
    consent_share = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    username = Column(String, nullable=False)
    role = Column(String, nullable=False)
    action = Column(String, nullable=False)  # READ, UPDATE, ERASE, DECRYPT, INGEST, ACCESS_DENIED
    resource = Column(String, nullable=False)
    reason = Column(String, nullable=True)   # GDPR/HIPAA justification (e.g., "Clinical Treatment", "System Log")
    status = Column(String, nullable=False)   # SUCCESS or DENIED
