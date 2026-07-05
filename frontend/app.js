// --- SecureData Compliance Framework App Logic ---

class AppState {
    constructor() {
        this.currentView = 'overview';
        this.role = 'Analyst';
        this.username = 'analyst_user';
        this.token = 'Analyst.analyst_user';
        this.patients = [];
        this.consents = [];
        this.auditLogs = [];
        
        // Decryption state (Admin only)
        this.decryptEnabled = false;
        this.justification = '';
        
        // Pipeline stats
        this.pipelineStats = {
            running: false,
            status: 'IDLE',
            records_ingested: 0,
            total_processed: 0
        };
        
        this.pollingInterval = null;
    }

    async init() {
        document.body.className = `role-${this.role}`;
        this.updateRoleBadge();
        await this.loadViewData();
        this.startPipelinePolling();
    }

    updateRoleBadge() {
        const container = document.getElementById('role-badge-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="role-badge-indicator role-badge-${this.role}">
                <span class="role-indicator-dot"></span>
                <span>Role: ${this.role}</span>
            </div>
        `;
        
        // Update the selector dropdown to match state
        const select = document.getElementById('user-role-select');
        if (select) {
            select.value = this.role;
        }
    }

    async changeRole(newRole) {
        this.role = newRole;
        document.body.className = `role-${newRole}`;
        this.decryptEnabled = false; // Reset decryption toggle on role switch
        this.justification = '';
        
        // Map roles to mock usernames
        if (newRole === 'Admin') {
            this.username = 'admin_user';
        } else if (newRole === 'Auditor') {
            this.username = 'auditor_user';
        } else {
            this.username = 'analyst_user';
        }
        
        this.token = `${this.role}.${this.username}`;
        this.updateRoleBadge();
        
        this.showToast(`Switched session role to: ${newRole}`, 'success');
        
        // Reload current view with new authorization context
        await this.loadViewData();
        this.renderActiveView();
    }

    navigateTo(viewId) {
        this.currentView = viewId;
        
        // Update nav active classes
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeNav = document.getElementById(`nav-${viewId}`);
        if (activeNav) {
            activeNav.classList.add('active');
        }
        
        // Update header title
        const titles = {
            overview: 'Overview Dashboard',
            explorer: 'Secure Data Explorer',
            consent: 'GDPR Consent Registry',
            erasure: 'Right to Erasure & Retention',
            audit: 'Immutable Security Audit Trail',
            mapping: 'Regulatory Controls Mapping Matrix'
        };
        document.getElementById('current-panel-title').innerText = titles[viewId] || 'Dashboard';
        
        this.loadViewData().then(() => {
            this.renderActiveView();
        });
    }

    async apiCall(endpoint, method = 'GET', body = null, headers = {}) {
        const loadingEl = document.getElementById('loading-indicator');
        if (loadingEl) loadingEl.style.display = 'block';

        const url = `/api/${endpoint}`;
        const defaultHeaders = {
            'Authorization': `Bearer ${this.token}`,
            'X-Role': this.role,
            'X-Username': this.username,
            'Content-Type': 'application/json'
        };
        
        if (this.decryptEnabled && this.justification) {
            defaultHeaders['X-Justification'] = this.justification;
            defaultHeaders['Justification'] = this.justification;
        }

        const config = {
            method,
            headers: { ...defaultHeaders, ...headers }
        };

        if (body) {
            config.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'API Error');
            }
            return await response.json();
        } catch (error) {
            console.error(`API Call failed (${endpoint}):`, error);
            this.showToast(error.message, 'danger');
            throw error;
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }

    async loadViewData() {
        try {
            // Load pipeline status (unrestricted)
            const status = await this.apiCall('pipeline/status');
            this.pipelineStats = status;

            // Conditional fetches based on current view requirements & roles
            if (this.currentView === 'overview') {
                // Fetch patient count/data to draw stats
                const data = await this.apiCall('patients');
                this.patients = data;
            } 
            else if (this.currentView === 'explorer') {
                const decryptQuery = this.decryptEnabled ? '?decrypt=true' : '';
                const data = await this.apiCall(`patients${decryptQuery}`);
                this.patients = data;
            } 
            else if (this.currentView === 'consent') {
                const data = await this.apiCall('consent');
                this.consents = data;
            } 
            else if (this.currentView === 'erasure') {
                // Admin only can load list for deletion
                if (this.role === 'Admin') {
                    const data = await this.apiCall('patients');
                    this.patients = data;
                }
            } 
            else if (this.currentView === 'audit') {
                if (this.role === 'Admin' || this.role === 'Auditor') {
                    const data = await this.apiCall('audit-logs');
                    this.auditLogs = data;
                }
            }
        } catch (e) {
            // Error handled inside apiCall toast
        }
    }

    startPipelinePolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        
        this.pollingInterval = setInterval(async () => {
            try {
                const status = await this.apiCall('pipeline/status');
                this.pipelineStats = status;
                
                // If on overview, update elements dynamically
                if (this.currentView === 'overview') {
                    this.updateOverviewStats();
                    this.updatePipelineVisualStatus();
                }
            } catch (e) {
                // Silently drop polling errors to avoid infinite toast alerts
            }
        }, 3000);
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast-notification');
        const text = document.getElementById('toast-message');
        if (!toast || !text) return;

        text.innerText = message;
        toast.className = `toast show toast-${type}`;

        setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }

    renderActiveView() {
        const container = document.getElementById('app-viewport');
        if (!container) return;

        switch (this.currentView) {
            case 'overview':
                container.innerHTML = this.getOverviewHTML();
                this.updatePipelineVisualStatus();
                break;
            case 'explorer':
                container.innerHTML = this.getExplorerHTML();
                break;
            case 'consent':
                container.innerHTML = this.getConsentHTML();
                break;
            case 'erasure':
                container.innerHTML = this.getErasureHTML();
                break;
            case 'audit':
                container.innerHTML = this.getAuditHTML();
                break;
            case 'mapping':
                container.innerHTML = this.getMappingHTML();
                break;
            default:
                container.innerHTML = `<h3>View not found</h3>`;
        }
    }

    // --- PIPELINE CONTROLS ---
    async controlPipeline(action) {
        try {
            const res = await this.apiCall('pipeline/control', 'POST', { action });
            this.showToast(res.message, 'success');
            
            // Reload database state immediately
            await this.loadViewData();
            this.renderActiveView();
        } catch (e) {
            // Error alerts handled in apiCall
        }
    }

    // --- CONSENT CONTROLS ---
    async toggleConsentItem(email, consentType, checkboxElement) {
        // Find existing consent preferences
        const entry = this.consents.find(c => c.email === email);
        if (!entry) return;

        // Clone preferences
        const updated = {
            email: entry.email,
            consent_marketing: entry.consent_marketing,
            consent_research: entry.consent_research,
            consent_share: entry.consent_share
        };
        
        // Update targeted preference
        updated[consentType] = checkboxElement.checked;

        try {
            await this.apiCall('consent', 'POST', updated);
            this.showToast(`Updated GDPR consent flags for ${email}`, 'success');
            // Refresh state
            await this.loadViewData();
        } catch (e) {
            // Revert checkbox state on API error
            checkboxElement.checked = !checkboxElement.checked;
        }
    }

    // --- ERASURE CONTROLS ---
    async erasePatientRecord(patientId) {
        if (!confirm(`WARNING: This executes GDPR Article 17 (Right to Erasure). All identifiable database records, consent registry records, and references for patient ID #${patientId} will be permanently destroyed. Are you sure you wish to proceed?`)) {
            return;
        }

        try {
            const res = await this.apiCall(`patients/${patientId}/erase`, 'DELETE');
            this.showToast(res.message, 'success');
            await this.loadViewData();
            this.renderActiveView();
        } catch (e) {
            // Handled
        }
    }

    // --- ADMIN DECRYPTION TOGGLE ---
    async toggleDecryption(checkbox) {
        if (checkbox.checked) {
            const input = document.getElementById('decrypt-justification-input');
            const reason = input ? input.value.trim() : '';
            
            if (reason.length < 5) {
                this.showToast("Compliance Violation Blocked: A detailed justification (min 5 characters) is required to decrypt PII.", "danger");
                checkbox.checked = false;
                return;
            }
            
            this.decryptEnabled = true;
            this.justification = reason;
        } else {
            this.decryptEnabled = false;
            this.justification = '';
        }
        
        await this.loadViewData();
        this.renderActiveView();
        this.showToast(this.decryptEnabled ? "Decrypted view activated (Audited)" : "Decrypted view deactivated", "info");
    }

    // --- AUDIT LOG SEARCH ---
    filterAuditLogs(query) {
        const tbody = document.getElementById('audit-logs-tbody');
        if (!tbody) return;

        const q = query.toLowerCase().trim();
        const filtered = this.auditLogs.filter(l => {
            return l.username.toLowerCase().includes(q) ||
                   l.action.toLowerCase().includes(q) ||
                   l.resource.toLowerCase().includes(q) ||
                   (l.reason && l.reason.toLowerCase().includes(q)) ||
                   l.status.toLowerCase().includes(q);
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem; color:var(--text-muted);">No matching audit logs found.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(l => {
            const timeStr = new Date(l.timestamp).toLocaleTimeString();
            const dateStr = new Date(l.timestamp).toLocaleDateString();
            const statusClass = `log-status-${l.status}`;

            // Classify actions for colored tags
            let tagClass = 'tag-read';
            const action = l.action;
            if (action.includes('INGEST') || action.includes('UPDATE_CONSENT')) {
                tagClass = 'tag-write';
            } else if (action.includes('ERASE') || action.includes('WIPE') || action.includes('DELETE') || action.includes('UNAUTHORIZED_DELETE') || action.includes('DATABASE')) {
                tagClass = 'tag-admin';
            }

            return `
                <tr>
                    <td style="font-family: var(--font-mono); font-size:0.8rem; white-space:nowrap;">
                        ${dateStr} <span style="color:var(--text-muted);">${timeStr}</span>
                    </td>
                    <td><span class="badge ${tagClass}">${l.action}</span></td>
                    <td style="font-family: var(--font-mono); font-size:0.85rem;">${l.resource}</td>
                    <td><strong>${l.username}</strong></td>
                    <td><span class="badge ${l.role === 'Admin' ? 'badge-raw' : 'badge-masked'}">${l.role}</span></td>
                    <td style="font-style: italic; font-size:0.85rem; color:var(--text-secondary);">${l.reason || '-'}</td>
                    <td><span class="${statusClass}">${l.status}</span></td>
                </tr>
            `;
        }).join('');
    }

    // --- HTML GENERATORS ---

    getOverviewHTML() {
        const totalRecords = this.patients.length;
        const totalEncrypted = totalRecords > 0 ? 100 : 0; // All records stored at-rest are encrypted
        const consentResearchCount = this.patients.filter(p => p.consent_research).length;
        const consentResearchPercent = totalRecords > 0 ? Math.round((consentResearchCount / totalRecords) * 100) : 0;
        
        return `
            <!-- GDPR & HIPAA Info Banner -->
            <div class="alert-banner">
                <div class="alert-icon">
                    <svg style="width: 24px; height: 24px;" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/>
                    </svg>
                </div>
                <div class="alert-content">
                    <h4>GDPR & HIPAA Compliance Guard Activated</h4>
                    <p>This prototype demonstrates end-to-end security compliance. Sensitive attributes (Names, SSNs, Phone numbers, Birth dates, Medical conditions) are automatically encrypted at-rest using AES-256 field-level keys. Data masking and anonymization rules dynamically filter columns based on the selected security clearance.</p>
                </div>
            </div>

            <!-- Metrics Grid -->
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-header">
                        <span>Total Records Ingested</span>
                        <svg style="width: 18px; height: 18px;" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                    </div>
                    <div class="metric-value" id="stat-total-records">${totalRecords}</div>
                    <div class="metric-footer">Stored in secure database</div>
                </div>
                <div class="metric-card">
                    <div class="metric-header">
                        <span>At-Rest Encryption</span>
                        <svg style="width: 18px; height: 18px; color: var(--success);" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
                    </div>
                    <div class="metric-value" style="color: var(--success);" id="stat-encryption-pct">${totalEncrypted}%</div>
                    <div class="metric-footer">AES-256 Column Field-Level</div>
                </div>
                <div class="metric-card">
                    <div class="metric-header">
                        <span>Research Consent Rate</span>
                        <svg style="width: 18px; height: 18px;" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                    </div>
                    <div class="metric-value" id="stat-consent-rate">${consentResearchPercent}%</div>
                    <div class="metric-footer">GDPR Art. 7 opt-in preference</div>
                </div>
                <div class="metric-card">
                    <div class="metric-header">
                        <span>Ingestion Stream</span>
                        <span class="role-indicator-dot" id="stat-stream-dot" style="background-color: var(--text-muted);"></span>
                    </div>
                    <div class="metric-value" style="font-size: 1.5rem;" id="stat-stream-status">STOPPED</div>
                    <div class="metric-footer" id="stat-stream-processed">Processed: 0 records</div>
                </div>
            </div>

            <!-- Big Data Pipeline Visualizer Panel -->
            <div class="pipeline-visualizer">
                <div class="panel-title">
                    <span>Big Data Ingestion Pipeline & Encryption Flow</span>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); font-family: var(--font-mono);" id="pipeline-status-text">State: Idle</span>
                </div>
                <div class="flow-container">
                    <!-- Source Node -->
                    <div class="flow-node">
                        <div class="flow-node-icon">
                            <svg style="width: 28px; height: 28px;" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
                            </svg>
                        </div>
                        <div class="flow-node-title">Raw Stream</div>
                        <div class="flow-node-meta">PII/PHI File Ingest</div>
                    </div>
                    
                    <!-- Line 1 -->
                    <div class="flow-connector" id="connector-1"></div>
                    
                    <!-- Kafka Ingestion Node -->
                    <div class="flow-node">
                        <div class="flow-node-icon" style="color: var(--warning);">
                            <svg style="width: 28px; height: 28px;" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.53c-.26-.81-1-1.4-1.9-1.4h-1v-3c0-.55-.45-1-1-1h-6v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                            </svg>
                        </div>
                        <div class="flow-node-title">Kafka Stream</div>
                        <div class="flow-node-meta">Ingestion Topic</div>
                    </div>
                    
                    <!-- Line 2 -->
                    <div class="flow-connector" id="connector-2"></div>
                    
                    <!-- Spark ETL Node -->
                    <div class="flow-node">
                        <div class="flow-node-icon" style="color: var(--info);">
                            <svg style="width: 28px; height: 28px;" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.9-1.9C9.12 19.62 10.51 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 15c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm-1-9h2v2h-2V9zm0 4h2v2h-2v-2z"/>
                            </svg>
                        </div>
                        <div class="flow-node-title">Spark Processing</div>
                        <div class="flow-node-meta">At-Rest Column Crypt</div>
                    </div>
                    
                    <!-- Line 3 -->
                    <div class="flow-connector" id="connector-3"></div>
                    
                    <!-- Secure DB Storage Node -->
                    <div class="flow-node">
                        <div class="flow-node-icon" style="color: var(--success);">
                            <svg style="width: 28px; height: 28px;" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12v5c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-5c0-5.52-4.48-10-10-10zm-2 15l-3-3 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                            </svg>
                        </div>
                        <div class="flow-node-title">SQLite Storage</div>
                        <div class="flow-node-meta">AES Encrypted Table</div>
                    </div>
                </div>
                
                <div class="pipeline-controls">
                    <button class="btn btn-primary" id="btn-start-stream" onclick="appState.controlPipeline('START')">
                        <svg style="width:16px;height:16px;fill:currentColor;" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        Start Streaming Ingestion
                    </button>
                    <button class="btn btn-danger" id="btn-stop-stream" onclick="appState.controlPipeline('STOP')">
                        <svg style="width:16px;height:16px;fill:currentColor;" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                        Stop Stream
                    </button>
                    <button class="btn btn-secondary" id="btn-reset-db" onclick="appState.controlPipeline('RESET')">
                        <svg style="width:16px;height:16px;fill:currentColor;" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                        Reset Application
                    </button>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                <div class="view-panel">
                    <h3 style="margin-bottom:1rem; font-size:1.15rem;">GDPR Compliance Controls Demo</h3>
                    <ul style="list-style-type: square; margin-left: 1.5rem; font-size:0.9rem; color:var(--text-secondary); display:flex; flex-direction:column; gap:0.5rem;">
                        <li><strong>Article 6 (Lawful Processing)</strong>: Data flows verify consent choice. Opting-out filters analytics fields.</li>
                        <li><strong>Article 7 (Consent Management)</strong>: Dynamic consent switches permit subjects to update permissions instantly.</li>
                        <li><strong>Article 17 (Right to Erasure)</strong>: Provides data erasure workflows, completely deleting PII columns and log links.</li>
                    </ul>
                </div>
                
                <div class="view-panel">
                    <h3 style="margin-bottom:1rem; font-size:1.15rem;">HIPAA Compliance Controls Demo</h3>
                    <ul style="list-style-type: square; margin-left: 1.5rem; font-size:0.9rem; color:var(--text-secondary); display:flex; flex-direction:column; gap:0.5rem;">
                        <li><strong>§164.312(a)(2)(iv) (Encryption)</strong>: AES-256 field-level cryptographic cipher runs during ingestion.</li>
                        <li><strong>§164.312(b) (Audit Controls)</strong>: Detailed transaction trail records reading, updating, and exporting events.</li>
                        <li><strong>§164.502(d) (De-identification)</strong>: Dynamically masks patient labels to binned decades, hashes names, and redacts SSNs.</li>
                    </ul>
                </div>
            </div>
        `;
    }

    updateOverviewStats() {
        const recordsEl = document.getElementById('stat-total-records');
        const encryptEl = document.getElementById('stat-encryption-pct');
        const consentEl = document.getElementById('stat-consent-rate');
        
        if (recordsEl) recordsEl.innerText = this.patients.length;
        if (encryptEl) encryptEl.innerText = this.patients.length > 0 ? '100%' : '0%';
        
        if (consentEl && this.patients.length > 0) {
            const consentResearchCount = this.patients.filter(p => p.consent_research).length;
            consentEl.innerText = `${Math.round((consentResearchCount / this.patients.length) * 100)}%`;
        }
    }

    updatePipelineVisualStatus() {
        const textEl = document.getElementById('pipeline-status-text');
        const streamStatusEl = document.getElementById('stat-stream-status');
        const processedEl = document.getElementById('stat-stream-processed');
        const dotEl = document.getElementById('stat-stream-dot');
        
        const connector1 = document.getElementById('connector-1');
        const connector2 = document.getElementById('connector-2');
        const connector3 = document.getElementById('connector-3');
        
        if (textEl) textEl.innerText = `State: ${this.pipelineStats.status}`;
        if (streamStatusEl) {
            streamStatusEl.innerText = this.pipelineStats.running ? 'RUNNING' : this.pipelineStats.status;
            streamStatusEl.style.color = this.pipelineStats.running ? 'var(--success)' : 'var(--text-primary)';
        }
        if (processedEl) {
            processedEl.innerText = `Ingested: ${this.pipelineStats.records_ingested} records`;
        }
        if (dotEl) {
            dotEl.style.backgroundColor = this.pipelineStats.running ? 'var(--success)' : 'var(--text-muted)';
            dotEl.style.boxShadow = this.pipelineStats.running ? '0 0 8px var(--success)' : 'none';
        }

        // Toggle connector animation classes
        [connector1, connector2, connector3].forEach(connector => {
            if (connector) {
                if (this.pipelineStats.running) {
                    connector.classList.add('flow-connector-active');
                } else {
                    connector.classList.remove('flow-connector-active');
                }
            }
        });
    }

    getExplorerHTML() {
        const rows = this.patients.map(p => {
            const hasMarketing = p.consent_marketing ? 'Yes' : 'No';
            const hasResearch = p.consent_research ? 'Yes' : 'No';
            
            const scopeClass = p.country !== 'United States' ? 'badge-eu' : 'badge-us';
            const scopeLabel = p.country !== 'United States' ? 'GDPR' : 'HIPAA';

            // Check dynamic masking status
            const maskBadge = p.is_masked 
                ? `<span class="badge badge-masked">MASKED (De-identified)</span>` 
                : `<span class="badge badge-raw">RAW PII/PHI</span>`;

            // If diagnostic field was blocked because of consent
            const isDiagnosisRestricted = p.diagnosis && p.diagnosis.includes('[RESTRICTED');
            const diagnosisCell = isDiagnosisRestricted 
                ? `<span class="restricted-cell">${p.diagnosis}</span>`
                : p.diagnosis;
                
            const treatmentCell = p.treatment && p.treatment.includes('[RESTRICTED') 
                ? `<span class="restricted-cell">${p.treatment}</span>`
                : p.treatment;

            const billingCell = p.billing_amount && p.billing_amount.toString().includes('[RESTRICTED') 
                ? `<span class="restricted-cell">${p.billing_amount}</span>`
                : (p.is_masked ? p.billing_amount : `$${parseFloat(p.billing_amount).toFixed(2)}`);

            return `
                <tr>
                    <td style="font-family: var(--font-mono); font-size:0.8rem;">#${p.id}</td>
                    <td><strong>${p.first_name} ${p.last_name}</strong></td>
                    <td>${p.email}</td>
                    <td style="font-family: var(--font-mono);">${p.ssn}</td>
                    <td>${p.birth_date}</td>
                    <td><span class="badge ${scopeClass}">${scopeLabel} (${p.country})</span></td>
                    <td>${diagnosisCell}</td>
                    <td>${treatmentCell}</td>
                    <td style="font-weight: 500;">${billingCell}</td>
                    <td>
                        <span class="badge ${p.consent_research ? 'badge-masked' : 'badge-raw'}" style="background-color: ${p.consent_research ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}; color: ${p.consent_research ? 'var(--success)' : 'var(--danger)'};">
                            Research: ${hasResearch}
                        </span>
                    </td>
                    <td>${maskBadge}</td>
                </tr>
            `;
        }).join('');

        let adminDecryptBar = '';
        if (this.role === 'Admin') {
            adminDecryptBar = `
                <div class="decrypt-authorization-bar">
                    <div style="display:flex; flex-direction:column; gap:0.25rem;">
                        <span style="font-weight:600; color:var(--warning);">Emergency Break-Glass Decryption</span>
                        <span style="font-size:0.8rem; color:var(--text-secondary);">Decrypting patient records exposes raw PII/PHI. Under HIPAA & GDPR policies, this requires auditing.</span>
                    </div>
                    <div class="justification-input-container">
                        <input type="text" id="decrypt-justification-input" class="justification-input" 
                            placeholder="Enter compliance justification (e.g. Clinical treatment override, Auditor request)..." 
                            value="${this.justification}"
                            ${this.decryptEnabled ? 'disabled' : ''}>
                        
                        <label class="switch" style="margin-left: 0.5rem; margin-top: auto; margin-bottom: auto;">
                            <input type="checkbox" id="decrypt-toggle-checkbox" onchange="appState.toggleDecryption(this)" ${this.decryptEnabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <span style="font-size: 0.8rem; font-weight:600; margin-left: 0.25rem; display:flex; align-items:center;">
                            ${this.decryptEnabled ? 'DECRYPTED' : 'MASKED'}
                        </span>
                    </div>
                </div>
            `;
        } else {
            adminDecryptBar = `
                <div class="decrypt-authorization-bar" style="background-color: rgba(255,255,255,0.02); border-color: var(--border-color);">
                    <svg style="width: 20px; height: 20px; fill: var(--text-muted);" viewBox="0 0 24 24">
                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                    </svg>
                    <span style="font-size: 0.85rem; color: var(--text-secondary); flex-grow: 1;">
                        Role <strong>${this.role}</strong> has read-only access. Full column-level decryption is restricted to administrators (Admin role) with registered justifications.
                    </span>
                </div>
            `;
        }

        return `
            <div class="view-panel">
                <div class="panel-header-actions">
                    <h3 style="font-size: 1.25rem; font-weight:600;">Patient Records Dataset</h3>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        Active Clearance: <strong>${this.role}</strong>
                    </div>
                </div>
                
                ${adminDecryptBar}

                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Email</th>
                                <th>SSN</th>
                                <th>DOB</th>
                                <th>Reg. Scope</th>
                                <th>Diagnosis</th>
                                <th>Treatment</th>
                                <th>Billing</th>
                                <th>Consent Status</th>
                                <th>Anonymization</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.length > 0 ? rows : '<tr><td colspan="11" style="text-align:center; padding: 2rem; color:var(--text-muted);">No records found. Ingest data using the pipeline simulation.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    getConsentHTML() {
        const cards = this.consents.map(c => {
            return `
                <div class="consent-card">
                    <div class="consent-card-header">
                        <div class="consent-card-name">Subject Ref: ${c.email.split('@')[0].toUpperCase()}</div>
                        <div class="consent-card-email">${c.email}</div>
                    </div>
                    
                    <div class="consent-toggle-row">
                        <span>Marketing Opt-in (GDPR Art. 7)</span>
                        <label class="switch">
                            <input type="checkbox" ${c.consent_marketing ? 'checked' : ''} 
                                onchange="appState.toggleConsentItem('${c.email}', 'consent_marketing', this)">
                            <span class="slider"></span>
                        </label>
                    </div>
                    
                    <div class="consent-toggle-row">
                        <span>Medical Research (Clinical Analytics)</span>
                        <label class="switch">
                            <input type="checkbox" ${c.consent_research ? 'checked' : ''} 
                                onchange="appState.toggleConsentItem('${c.email}', 'consent_research', this)">
                            <span class="slider"></span>
                        </label>
                    </div>
                    
                    <div class="consent-toggle-row">
                        <span>Third-Party Sharing (Financial Billing)</span>
                        <label class="switch">
                            <input type="checkbox" ${c.consent_share ? 'checked' : ''} 
                                onchange="appState.toggleConsentItem('${c.email}', 'consent_share', this)">
                            <span class="slider"></span>
                        </label>
                    </div>
                    
                    <div style="font-size:0.7rem; color:var(--text-muted); text-align:right; margin-top:0.75rem;">
                        Last Sync: ${new Date(c.updated_at).toLocaleTimeString()}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="view-panel">
                <p class="panel-description">
                    Manage patient consent preferences according to GDPR Article 7. In the SecureData compliance framework, turning off research or third-party sharing consent immediately masks corresponding database column views for analysts and downstream big-data processing.
                </p>
                
                <div class="consent-grid">
                    ${cards.length > 0 ? cards : '<div style="grid-column: 1/-1; text-align:center; padding: 2rem; color:var(--text-muted);">Consent records are empty. Run pipeline streams to ingest.</div>'}
                </div>
            </div>
        `;
    }

    getErasureHTML() {
        if (this.role !== 'Admin') {
            return `
                <div class="view-panel">
                    <div style="text-align: center; padding: 3rem 1rem;">
                        <svg style="width: 64px; height: 64px; fill: var(--danger); opacity:0.6; margin-bottom:1rem;" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                        </svg>
                        <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem;">Access Restrained by RBAC Policy</h3>
                        <p style="color:var(--text-secondary); font-size:0.9rem; max-width:500px; margin:0 auto;">
                            GDPR Article 17 "Right to be Forgotten" deletion actions and HIPAA retention policy management are restricted to administrative accounts. Please switch your role to <strong>System Administrator</strong> to test this deletion pipeline.
                        </p>
                    </div>
                </div>
            `;
        }

        const rows = this.patients.map(p => {
            return `
                <tr>
                    <td style="font-family: var(--font-mono); font-size:0.8rem;">#${p.id}</td>
                    <td><strong>${p.first_name} ${p.last_name}</strong></td>
                    <td>${p.email}</td>
                    <td><span class="badge ${p.country !== 'United States' ? 'badge-eu' : 'badge-us'}">${p.country}</span></td>
                    <td style="font-family: var(--font-mono); font-size:0.8rem;">${new Date(p.ingested_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-danger" style="padding:0.35rem 0.75rem; font-size:0.8rem;" onclick="appState.erasePatientRecord(${p.id})">
                            <svg style="width:14px;height:14px;fill:currentColor;" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            Erase Data
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="view-panel">
                <p class="panel-description">
                    Process erasure requests for data subjects under GDPR Article 17. Selecting "Erase Data" initiates a deletion pipeline that removes the client's information from storage registers and updates the compliance log.
                </p>

                <div class="erasure-container">
                    <h3 style="font-size:1.1rem; margin-bottom:1rem;">Active Data Subjects</h3>
                    
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Identified Subject</th>
                                    <th>Email ID</th>
                                    <th>Reg. Jurisdiction</th>
                                    <th>Ingestion Date</th>
                                    <th>Erasure Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.length > 0 ? rows : '<tr><td colspan="6" style="text-align:center; padding: 2rem; color:var(--text-muted);">No active records to display.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="danger-zone">
                        <h4 class="danger-zone-title">Regulatory Data Retention Settings (HIPAA Compliance)</h4>
                        <p class="danger-zone-desc">
                            HIPAA mandates that health records be preserved for a minimum of 6 years (§164.312(a)). If GDPR Art. 17 right-to-erasure overrides clinical patient data, this system logs the request but retains aggregate billing files for accounting auditing.
                        </p>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); background: rgba(0,0,0,0.2); padding:0.75rem; border-radius:6px;">
                            <strong>Data retention policy status:</strong> Active &bull; Minimum retention: 2,190 days (6 years) &bull; Automated purge: Enabled
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getAuditHTML() {
        if (this.role !== 'Admin' && this.role !== 'Auditor') {
            return `
                <div class="view-panel">
                    <div style="text-align: center; padding: 3rem 1rem;">
                        <svg style="width: 64px; height: 64px; fill: var(--danger); opacity:0.6; margin-bottom:1rem;" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                        </svg>
                        <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem;">Access Denied (Auditing Requirement)</h3>
                        <p style="color:var(--text-secondary); font-size:0.9rem; max-width:520px; margin:0 auto;">
                            Central Security and Compliance Audit trails are restricted to compliance auditors and administrators under HIPAA §164.312(b) Audit Controls. Switch role to <strong>Compliance Auditor</strong> or <strong>System Administrator</strong> to access logs.
                        </p>
                    </div>
                </div>
            `;
        }

        const rows = this.auditLogs.map(l => {
            const timeStr = new Date(l.timestamp).toLocaleTimeString();
            const dateStr = new Date(l.timestamp).toLocaleDateString();
            const statusClass = `log-status-${l.status}`;

            // Classify actions for colored tags
            let tagClass = 'tag-read'; // default blue
            const action = l.action;
            if (action.includes('INGEST') || action.includes('UPDATE_CONSENT')) {
                tagClass = 'tag-write'; // orange
            } else if (action.includes('ERASE') || action.includes('WIPE') || action.includes('DELETE') || action.includes('UNAUTHORIZED_DELETE') || action.includes('DATABASE')) {
                tagClass = 'tag-admin'; // yellow
            }

            return `
                <tr>
                    <td style="font-family: var(--font-mono); font-size:0.8rem; white-space:nowrap;">
                        ${dateStr} <span style="color:var(--text-muted);">${timeStr}</span>
                    </td>
                    <td><span class="badge ${tagClass}">${l.action}</span></td>
                    <td style="font-family: var(--font-mono); font-size:0.85rem;">${l.resource}</td>
                    <td><strong>${l.username}</strong></td>
                    <td><span class="badge ${l.role === 'Admin' ? 'badge-raw' : 'badge-masked'}">${l.role}</span></td>
                    <td style="font-style: italic; font-size:0.85rem; color:var(--text-secondary);">${l.reason || '-'}</td>
                    <td><span class="${statusClass}">${l.status}</span></td>
                </tr>
            `;
        }).join('');

        return `
            <div class="view-panel">
                <p class="panel-description">
                    Provides traceability for system queries under HIPAA §164.312(b) and GDPR Article 32. Transactions involving data ingestion, updates, right-to-erasure deletion requests, and administrative key decryption are logged.
                </p>

                <div class="logs-filter-row" style="margin-bottom: 1.5rem; display: flex; gap: 1rem;">
                    <input type="text" id="audit-search-input" class="search-input" 
                        oninput="appState.filterAuditLogs(this.value)" 
                        placeholder="Search logs by operator, action, resource, justification...">
                </div>

                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Action</th>
                                <th>Resource / Target</th>
                                <th>Operator</th>
                                <th>Clearance</th>
                                <th>Justification</th>
                                <th>Outcome</th>
                            </tr>
                        </thead>
                        <tbody id="audit-logs-tbody">
                            ${rows.length > 0 ? rows : '<tr><td colspan="7" style="text-align:center; padding: 2rem; color:var(--text-muted);">Audit log is currently empty. Run transactions to populate.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    getMappingHTML() {
        return `
            <div class="view-panel">
                <p class="panel-description" style="margin-bottom:2rem;">
                    Matches backend compliance controls with the regulatory frameworks of the European Union General Data Protection Regulation (GDPR) and the United States Health Insurance Portability and Accountability Act (HIPAA).
                </p>
                
                <div class="mapping-matrix">
                    <!-- Control 1 -->
                    <div class="mapping-card gdpr">
                        <div class="mapping-card-header">
                            <span class="mapping-clause">GDPR Art. 32 / HIPAA §164.312(a)(2)(iv)</span>
                            <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:600; text-transform:uppercase;">Encryption Controls</span>
                        </div>
                        <h4 class="mapping-title">At-Rest Field-Level Cryptography</h4>
                        <p class="mapping-desc">Mandates implementation of technical standards to protect sensitive storage records from physical or system theft.</p>
                        
                        <div class="mapping-control-implemented">
                            <div class="control-label">Technical Enforcement:</div>
                            <div class="control-detail">
                                Python backend intercepts SQL writes via SQLAlchemy. Sensitive fields (Name, Email, SSN, DOB, Diagnostics, Billing) are encrypted using AES-256 ciphers (Fernet) before storage. Data is stored on disk as base64 ciphertext blocks.
                            </div>
                        </div>
                    </div>
                    
                    <!-- Control 2 -->
                    <div class="mapping-card gdpr">
                        <div class="mapping-card-header">
                            <span class="mapping-clause">GDPR Art. 7 (Consent)</span>
                            <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:600; text-transform:uppercase;">Data Subject Autonomy</span>
                        </div>
                        <h4 class="mapping-title">Consent Registry Synchronization</h4>
                        <p class="mapping-desc">Requires that systems respect data subject selections regarding data usage boundaries.</p>
                        
                        <div class="mapping-control-implemented">
                            <div class="control-label">Technical Enforcement:</div>
                            <div class="control-detail">
                                The registry records data subject selections. If research or sharing consent flags are cleared, the API dynamically masks clinical columns for queries made by non-administrative users.
                            </div>
                        </div>
                    </div>
                    
                    <!-- Control 3 -->
                    <div class="mapping-card gdpr">
                        <div class="mapping-card-header">
                            <span class="mapping-clause">GDPR Art. 17 (Right to Erasure)</span>
                            <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:600; text-transform:uppercase;">Data Subject Autonomy</span>
                        </div>
                        <h4 class="mapping-title">GDPR Right to Be Forgotten Pipeline</h4>
                        <p class="mapping-desc">Provides data subjects the right to request deletion of their personal records under certain conditions.</p>
                        
                        <div class="mapping-control-implemented">
                            <div class="control-label">Technical Enforcement:</div>
                            <div class="control-detail">
                                Triggers a pipeline deletion when selected by Admin. The patient table row is deleted along with related consent mappings, logging the compliance action to the audit logs.
                            </div>
                        </div>
                    </div>

                    <!-- Control 4 -->
                    <div class="mapping-card hipaa">
                        <div class="mapping-card-header">
                            <span class="mapping-clause">HIPAA §164.312(b) (Audit Controls)</span>
                            <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:600; text-transform:uppercase;">Traceability</span>
                        </div>
                        <h4 class="mapping-title">Central Compliance Audit Ledger</h4>
                        <p class="mapping-desc">Requires logging all events related to PHI reads, writes, decryption operations, and deletions.</p>
                        
                        <div class="mapping-control-implemented">
                            <div class="control-label">Technical Enforcement:</div>
                            <div class="control-detail">
                                The 'audit_logs' database is updated by FastAPI whenever endpoints are hit. Accesses record timestamp, actor, clearance, action type, resource ID, outcome, and Admin justifications.
                            </div>
                        </div>
                    </div>
                    
                    <!-- Control 5 -->
                    <div class="mapping-card hipaa">
                        <div class="mapping-card-header">
                            <span class="mapping-clause">HIPAA §164.502(d) (De-identification)</span>
                            <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:600; text-transform:uppercase;">Data Protection</span>
                        </div>
                        <h4 class="mapping-title">Role-Based Access Control & Anonymization</h4>
                        <p class="mapping-desc">Requires restricting PHI viewing strictly to roles needing the information for clinical or operations tasks.</p>
                        
                        <div class="mapping-control-implemented">
                            <div class="control-label">Technical Enforcement:</div>
                            <div class="control-detail">
                                The API dynamically masks patient labels based on active credentials. Analyst/Auditor roles receive pseudonymized labels (e.g. Patient_C312), masked SSNs, and birth years only.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Instantiate Global State
const appState = new AppState();

// Initialize application on load
window.addEventListener('DOMContentLoaded', () => {
    appState.init().then(() => {
        appState.renderActiveView();
    });
});
