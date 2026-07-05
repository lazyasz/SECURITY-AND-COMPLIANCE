import datetime
from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from database import get_db, Base, engine
from models import PatientRecord, ConsentRegistry, AuditLog
from encryption import (
    decrypt_field,
    pseudonymize_name,
    mask_email,
    mask_phone,
    mask_ssn,
    mask_birth_date,
    anonymize_billing_amount
)
from pipeline import pipeline_instance

# Initialize database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="SecureData Compliance Framework API")

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For prototype simplicity; restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Schemas for Requests/Responses ---
class TokenRequest(BaseModel):
    username: str
    role: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    role: str
    username: str

class ConsentUpdateSchema(BaseModel):
    email: str
    consent_marketing: bool
    consent_research: bool
    consent_share: bool

class PipelineControlSchema(BaseModel):
    action: str  # START, STOP, RESET

# --- Helper Dependency for Token Checking (RBAC) ---
def get_current_user(
    authorization: Optional[str] = Header(None),
    x_role: Optional[str] = Header(None),
    x_username: Optional[str] = Header(None)
):
    """
    Dependency to authenticate and identify the current user role.
    Decodes standard Bearer tokens (format: role.username) or fallback headers.
    """
    role = x_role or "Analyst"
    username = x_username or "anonymous"
    
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        try:
            # Decode mock token "role.username"
            parts = token.split(".")
            if len(parts) >= 2:
                role = parts[0]
                username = parts[1]
        except Exception:
            pass
            
    if role not in ["Admin", "Analyst", "Auditor", "System"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid security credentials / unrecognized role."
        )
        
    return {"username": username, "role": role}

@app.on_event("startup")
def startup_event():
    """Seed initial records for demonstration on startup."""
    pipeline_instance.seed_initial_data()

# --- Auth Endpoint ---
@app.post("/api/auth/token", response_model=TokenResponse)
def login(request: TokenRequest):
    """Simulate a token generation endpoint for the three demonstration roles."""
    if request.role not in ["Admin", "Analyst", "Auditor"]:
        raise HTTPException(status_code=400, detail="Invalid role requested")
    
    # Generate a mock Bearer token "role.username"
    token = f"{request.role}.{request.username}"
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": request.role,
        "username": request.username
    }

# --- Patient Records Endpoint (RBAC & Dynamic Masking) ---
@app.get("/api/patients")
def get_patients(
    decrypt: bool = False,
    justification: Optional[str] = Header(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Fetch patient records with dynamic compliance masking based on user role.
    
    - Admin: Views masked data by default. Can query decrypt=True with a justification header.
    - Analyst: Views masked data only. Specific columns masked further based on consent registry.
    - Auditor: Views masked data only. Audit logs are accessible.
    """
    role = current_user["role"]
    username = current_user["username"]
    
    # Log attempt to fetch records
    access_action = "READ_PATIENTS_MASKED"
    log_status = "SUCCESS"
    log_reason = "Standard data browsing"
    
    if decrypt:
        if role != "Admin":
            # Log denied decrypt attempt (GDPR Art. 32 violation block)
            denied_log = AuditLog(
                timestamp=datetime.datetime.utcnow(),
                username=username,
                role=role,
                action="UNAUTHORIZED_DECRYPT_ATTEMPT",
                resource="All Patients PII/PHI",
                reason=f"Attempted decryption without Admin privileges",
                status="DENIED"
            )
            db.add(denied_log)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access Denied: Only Admin accounts can request unmasked PII/PHI."
            )
        
        if not justification or len(justification.strip()) < 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Compliance Justification Required: Admin must state reason to decrypt raw PII/PHI."
            )
        
        access_action = "READ_PATIENTS_DECRYPTED"
        log_reason = f"Decryption Authorized: {justification}"

    # Fetch active records (excluding erased patients)
    records = db.query(PatientRecord).filter(PatientRecord.erased_at == None).all()
    response_data = []

    for r in records:
        # Decrypt fields for processing
        first_name = decrypt_field(r.first_name_encrypted)
        last_name = decrypt_field(r.last_name_encrypted)
        email = decrypt_field(r.email_encrypted)
        phone = decrypt_field(r.phone_encrypted)
        ssn = decrypt_field(r.ssn_encrypted)
        birth_date = decrypt_field(r.birth_date_encrypted)
        diagnosis = decrypt_field(r.diagnosis_encrypted)
        treatment = decrypt_field(r.treatment_encrypted)
        billing_amount = decrypt_field(r.billing_amount_encrypted)

        # Apply masking policies
        if decrypt and role == "Admin":
            # Return raw values
            patient_entry = {
                "id": r.id,
                "first_name": first_name,
                "last_name": last_name,
                "email": email,
                "phone": phone,
                "ssn": ssn,
                "birth_date": birth_date,
                "gender": r.gender,
                "country": r.country,
                "diagnosis": diagnosis,
                "treatment": treatment,
                "billing_amount": billing_amount,
                "consent_marketing": r.consent_marketing,
                "consent_research": r.consent_research,
                "consent_share": r.consent_share,
                "ingested_at": r.ingested_at,
                "is_masked": False
            }
        else:
            # Masked view (enforced for Analyst, Auditor, and Admin by default)
            masked_name = pseudonymize_name(first_name, last_name)
            
            # Consent Check (GDPR Article 6 & 7)
            # If data subject has opted out of research, mask diagnosis/treatment for Analyst
            display_diagnosis = diagnosis
            display_treatment = treatment
            
            if role == "Analyst" and not r.consent_research:
                display_diagnosis = "[RESTRICTED - NO RESEARCH CONSENT]"
                display_treatment = "[RESTRICTED - NO RESEARCH CONSENT]"
            
            # If opted out of sharing, redact financial billing for Analyst
            display_billing = billing_amount
            if role == "Analyst":
                if not r.consent_share:
                    display_billing = "[RESTRICTED - NO SHARE CONSENT]"
                else:
                    display_billing = anonymize_billing_amount(billing_amount)
            elif role == "Auditor":
                display_billing = anonymize_billing_amount(billing_amount)

            patient_entry = {
                "id": r.id,
                "first_name": masked_name.split("_")[0],
                "last_name": masked_name.split("_")[1],
                "email": mask_email(email),
                "phone": mask_phone(phone),
                "ssn": mask_ssn(ssn),
                "birth_date": mask_birth_date(birth_date),
                "gender": r.gender,
                "country": r.country,
                "diagnosis": display_diagnosis,
                "treatment": display_treatment,
                "billing_amount": display_billing,
                "consent_marketing": r.consent_marketing,
                "consent_research": r.consent_research,
                "consent_share": r.consent_share,
                "ingested_at": r.ingested_at,
                "is_masked": True,
                "pseudonym": masked_name
            }
            
        response_data.append(patient_entry)

    # Log the access
    audit_log = AuditLog(
        timestamp=datetime.datetime.utcnow(),
        username=username,
        role=role,
        action=access_action,
        resource="All Patient Records",
        reason=log_reason,
        status=log_status
    )
    db.add(audit_log)
    db.commit()

    return response_data

# --- Consent Management Endpoints (GDPR Art. 7) ---
@app.get("/api/consent")
def get_consent_registry(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve full list of data subjects and their consent states."""
    # Analysts & Admins & Auditors can view consent records
    consents = db.query(ConsentRegistry).all()
    
    # Audit log consent check
    audit_log = AuditLog(
        timestamp=datetime.datetime.utcnow(),
        username=current_user["username"],
        role=current_user["role"],
        action="READ_CONSENT_REGISTRY",
        resource="Consent Registry Table",
        reason="Viewing user consent declarations",
        status="SUCCESS"
    )
    db.add(audit_log)
    db.commit()
    
    return consents

@app.post("/api/consent")
def update_consent(
    update_data: ConsentUpdateSchema,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update consent preferences for a data subject."""
    # Find matching consent record
    consent = db.query(ConsentRegistry).filter(ConsentRegistry.email == update_data.email).first()
    if not consent:
        raise HTTPException(status_code=404, detail="Consent record not found for this email.")
    
    # Update properties
    consent.consent_marketing = update_data.consent_marketing
    consent.consent_research = update_data.consent_research
    consent.consent_share = update_data.consent_share
    consent.updated_at = datetime.datetime.utcnow()
    
    # Update linked PatientRecord flags too
    patient = db.query(PatientRecord).filter(PatientRecord.id == consent.patient_id).first()
    if patient:
        patient.consent_marketing = update_data.consent_marketing
        patient.consent_research = update_data.consent_research
        patient.consent_share = update_data.consent_share
        
    # Log update action
    audit_log = AuditLog(
        timestamp=datetime.datetime.utcnow(),
        username=current_user["username"],
        role=current_user["role"],
        action="UPDATE_CONSENT",
        resource=f"Consent ID: {consent.id} (Email: {update_data.email})",
        reason="Consent status updated by request",
        status="SUCCESS"
    )
    db.add(audit_log)
    db.commit()
    
    return {"message": "Consent updated successfully.", "email": update_data.email}

# --- GDPR Article 17 "Right to Erasure" Endpoint ---
@app.delete("/api/patients/{patient_id}/erase")
def erase_patient(
    patient_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enforces GDPR Article 17 "Right to be Forgotten".
    Wipes all identifiable data from database store, records erasure audit log.
    Only Admin role is permitted.
    """
    role = current_user["role"]
    username = current_user["username"]
    
    if role != "Admin":
        denied_log = AuditLog(
            timestamp=datetime.datetime.utcnow(),
            username=username,
            role=role,
            action="UNAUTHORIZED_DELETE_ATTEMPT",
            resource=f"Patient ID: {patient_id}",
            reason="Attempted to invoke GDPR right to erasure without Admin privilege",
            status="DENIED"
        )
        db.add(denied_log)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: Only Admin can execute GDPR Right to Erasure."
        )
        
    patient = db.query(PatientRecord).filter(PatientRecord.id == patient_id).first()
    if not patient or patient.erased_at is not None:
        raise HTTPException(status_code=404, detail="Active patient record not found")
        
    # Capture email to delete consent entry too
    email = decrypt_field(patient.email_encrypted)
    
    # 1. Clear details (Cryptographic Erasure / Hard Delete combo)
    # Delete consent registry record
    db.query(ConsentRegistry).filter(ConsentRegistry.patient_id == patient_id).delete()
    if email:
        db.query(ConsentRegistry).filter(ConsentRegistry.email == email).delete()
        
    # Remove Patient Record entirely
    db.delete(patient)
    
    # 2. Record Erasure in Audit Logs
    audit_log = AuditLog(
        timestamp=datetime.datetime.utcnow(),
        username=username,
        role=role,
        action="ERASE_PATIENT_GDPR_ART17",
        resource=f"Patient ID: {patient_id}",
        reason="GDPR Article 17 Right to Erasure requested by data subject",
        status="SUCCESS"
    )
    db.add(audit_log)
    db.commit()
    
    return {"message": f"Patient record {patient_id} completely erased from system databases."}

# --- Audit Logs Endpoint ---
@app.get("/api/audit-logs")
def get_audit_logs(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve full compliance logs. Enforces RBAC protection (Admins & Auditors only)."""
    role = current_user["role"]
    username = current_user["username"]
    
    if role not in ["Admin", "Auditor"]:
        # Log unauthorized attempt to read audits
        denied_log = AuditLog(
            timestamp=datetime.datetime.utcnow(),
            username=username,
            role=role,
            action="UNAUTHORIZED_AUDIT_ACCESS",
            resource="System Compliance Logs",
            reason="Analyst role tried to access central audit logs",
            status="DENIED"
        )
        db.add(denied_log)
        db.commit()
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: Only Auditor or Admin roles are authorized to view audit logs."
        )
        
    logs = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).all()
    return logs

# --- Ingestion Pipeline Controls ---
@app.get("/api/pipeline/status")
def get_pipeline_status():
    """Retrieve active status and metrics of simulated Kafka/Spark stream."""
    return {
        "running": pipeline_instance._running,
        "status": pipeline_instance.current_status,
        "records_ingested": pipeline_instance.records_ingested,
        "total_processed": pipeline_instance.total_processed
    }

@app.post("/api/pipeline/control")
def control_pipeline(
    control: PipelineControlSchema,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start, stop, or wipe database logs/records (Admin/Auditor control)."""
    role = current_user["role"]
    if role not in ["Admin", "System"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: Only Admin can control ingestion pipelines."
        )
        
    action = control.action.upper()
    if action == "START":
        success = pipeline_instance.start()
        msg = "Pipeline started" if success else "Pipeline already running"
    elif action == "STOP":
        success = pipeline_instance.stop()
        msg = "Pipeline stopped" if success else "Pipeline not running"
    elif action == "RESET":
        success = pipeline_instance.reset_db()
        msg = "Database reset complete" if success else "Error resetting database"
    else:
        raise HTTPException(status_code=400, detail="Invalid pipeline command.")
        
    return {"message": msg, "success": success}

# --- Static File Serving ---
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
# Ensure the directory exists
os.makedirs(frontend_path, exist_ok=True)

# Mount frontend directory for static assets
app.mount("/assets", StaticFiles(directory=frontend_path), name="assets")

@app.get("/")
def read_root():
    return FileResponse(os.path.join(frontend_path, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
