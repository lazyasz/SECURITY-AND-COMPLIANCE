import os
import hashlib
from cryptography.fernet import Fernet

KEY_FILE = os.path.join(os.path.dirname(__file__), "secret.key")

def get_encryption_key() -> bytes:
    """Load or generate a cryptographic key for AES field-level encryption."""
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read()
    else:
        key = Fernet.generate_key()
        with open(KEY_FILE, "wb") as f:
            f.write(key)
        return key

# Initialize Cipher Suite
cipher_suite = Fernet(get_encryption_key())

def encrypt_field(value: str) -> str:
    """Encrypt a plaintext string field to base64 encrypted string."""
    if value is None:
        return None
    encoded_value = str(value).encode('utf-8')
    encrypted_bytes = cipher_suite.encrypt(encoded_value)
    return encrypted_bytes.decode('utf-8')

def decrypt_field(encrypted_value: str) -> str:
    """Decrypt a base64 encrypted string back to plaintext."""
    if encrypted_value is None:
        return None
    try:
        decrypted_bytes = cipher_suite.decrypt(str(encrypted_value).encode('utf-8'))
        return decrypted_bytes.decode('utf-8')
    except Exception as e:
        return f"[Decryption Error: {str(e)}]"

# --- Anonymization and Masking Helpers (GDPR / HIPAA) ---

def pseudonymize_name(first_name: str, last_name: str) -> str:
    """
    Generates a stable, non-reversible patient pseudonym (e.g. Patient_E89B)
    using SHA-256 hash. Satisfies GDPR pseudonymization (Recital 26).
    """
    if not first_name or not last_name:
        return "Patient_UNKNOWN"
    combined = f"{first_name.strip().lower()}:{last_name.strip().lower()}"
    h = hashlib.sha256(combined.encode()).hexdigest()
    return f"Patient_{h[:6].upper()}"

def mask_email(email: str) -> str:
    """Mask email for privacy, e.g. john.doe@example.com -> j***e@example.com"""
    if not email or "@" not in email:
        return "e***@example.com"
    parts = email.split("@")
    name = parts[0]
    domain = parts[1]
    if len(name) <= 2:
        return f"{name[0]}***@{domain}"
    return f"{name[0]}***{name[-1]}@{domain}"

def mask_phone(phone: str) -> str:
    """Mask telephone number, e.g. +1-555-0199 -> +1-555-****"""
    if not phone:
        return "***-***-****"
    if len(phone) > 4:
        return f"{phone[:-4]}****"
    return "****"

def mask_ssn(ssn: str) -> str:
    """SSN Masking, e.g. 999-12-3456 -> ***-**-3456"""
    if not ssn:
        return "***-**-****"
    parts = ssn.split("-")
    if len(parts) == 3:
        return f"***-**-{parts[2]}"
    # Fallback if unformatted
    if len(ssn) >= 4:
        return f"***-**-{ssn[-4:]}"
    return "***-**-****"

def mask_birth_date(birth_date: str) -> str:
    """
    HIPAA Safe Harbor rule: remove specific birth date details.
    Retains only the birth year for age context. E.g., 1975-08-24 -> 1975-**-**
    """
    if not birth_date:
        return "****-**-**"
    return f"{birth_date[:4]}-**-**"

def anonymize_billing_amount(amount_str: str) -> str:
    """
    Anonymize financial data by rounding to the nearest $500 bucket.
    Prevents precise reconstruction of individual billing records.
    """
    if not amount_str:
        return "$0 (Binned)"
    try:
        amount = float(amount_str)
        binned = round(amount / 500.0) * 500
        return f"Approx. ${binned}"
    except Exception:
        return "$***"
