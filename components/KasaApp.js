'use client';

import { useEffect, useState } from 'react';
import {
  supabase,
  GENERAL_ID,
  CURRENCIES,
  fmtMoney,
  fmtDate,
  todayStr,
  uid,
  currencyMeta,
  invalidRateKeys,
  debtTRYValue,
  debtTRYValueLive,
  debtPaidAmount,
  debtRemaining,
  isDebtSettled,
  debtInstallmentsFor,
  addMonthsToDateStr,
  buildInstallmentAmounts,
} from '../lib/supabaseClient';

const SESSION_KEY = 'kasa_current_user';

function saveSession(name) {
  try { window.localStorage.setItem(SESSION_KEY, name); } catch (e) { /* localStorage kapalı olabilir */ }
}
function readSession() {
  try { return window.localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
}
function clearSession() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch (e) { /* localStorage kapalı olabilir */ }
}

const CATS_GELIR = ['Satış', 'Hizmet', 'Diğer Gelir'];

export default function KasaApp() {
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState(null);

  const [settings, setSettings] = useState(null);
  const [projects, setProjects] = useState([]);
  const [txns, setTxns] = useState([]);
  const [debts, setDebts] = useState([]);
  const [debtPayments, setDebtPayments] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [banks, setBanks] = useState([]);
  const [paymentDebtId, setPaymentDebtId] = useState(null);
  const [rates, setRates] = useState(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [rateIssueDismissed, setRateIssueDismissed] = useState(false);
  const [rateIssueAttempted, setRateIssueAttempted] = useState(false);

  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState('loading'); // loading | setup | login | overview | project | debts
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [formType, setFormType] = useState('gider');
  const [projectTab, setProjectTab] = useState('hareketler');
  const [debtFormType, setDebtFormType] = useState('alinan');
  const [debtFilter, setDebtFilter] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [editProjectTarget, setEditProjectTarget] = useState(null);
  const [editDebtTarget, setEditDebtTarget] = useState(null);
  const [editTxnTarget, setEditTxnTarget] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null); // { message, onYes }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setConnError(null);
    try {
      const { data: settingsRow, error: sErr } = await supabase.from('kasa_settings').select('*').eq('id', 1).maybeSingle();
      if (sErr) throw sErr;

      const { data: projectRows, error: pErr } = await supabase.from('kasa_projects').select('*').order('created_at', { ascending: true });
      if (pErr) throw pErr;

      const { data: txnRows, error: tErr } = await supabase.from('kasa_transactions').select('*');
      if (tErr) throw tErr;

      const { data: debtRows, error: dErr } = await supabase.from('kasa_debts').select('*');
      if (dErr) throw dErr;

      const { data: paymentRows, error: pmErr } = await supabase.from('kasa_debt_payments').select('*');
      if (pmErr) throw pmErr;

      const { data: installmentRows, error: instErr } = await supabase.from('kasa_debt_installments').select('*');
      if (instErr) throw instErr;

      const { data: bankRows, error: bankErr } = await supabase.from('kasa_banks').select('*').order('name', { ascending: true });
      if (bankErr) throw bankErr;

      const { data: rateRow, error: rErr } = await supabase.from('kasa_rates').select('*').eq('id', 1).maybeSingle();
      if (rErr) throw rErr;

      let finalProjects = projectRows || [];
      if (!finalProjects.some((p) => p.id === GENERAL_ID)) {
        const generalRow = { id: GENERAL_ID, name: 'Genel Şirket Giderleri', is_general: true, created_at: new Date().toISOString() };
        const { error: insErr } = await supabase.from('kasa_projects').insert(generalRow);
        if (!insErr) finalProjects = [generalRow, ...finalProjects];
      }

      setSettings(settingsRow || null);
      setProjects(finalProjects);
      setTxns(txnRows || []);
      setDebts(debtRows || []);
      setDebtPayments(paymentRows || []);
      setInstallments(installmentRows || []);
      setBanks(bankRows || []);
      setRates(rateRow || null);
      setView(settingsRow ? 'login' : 'setup');

      if (settingsRow) {
        const savedUser = readSession();
        if (savedUser && (savedUser === settingsRow.user1 || savedUser === settingsRow.user2)) {
          setCurrentUser(savedUser);
          setView('overview');
        }
      }

      const needsRefresh = !rateRow || (rateRow.fetched_date_str !== todayStr() && new Date().getHours() >= 10);
      if (needsRefresh) refreshRates();
    } catch (e) {
      console.error(e);
      setConnError(e.message || 'Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  }

  async function refreshRates() {
    setRatesLoading(true);
    try {
      const resp = await fetch('/api/rates/refresh', { method: 'POST', headers: { 'x-manual-refresh': 'true' } });
      const json = await resp.json();
      if (json && json.rates) {
        setRates(json.rates);
      } else {
        const { data } = await supabase.from('kasa_rates').select('*').eq('id', 1).maybeSingle();
        setRates(data || null);
      }
      setRateIssueDismissed(false);
    } catch (e) {
      console.error('Kur güncellenemedi', e);
    } finally {
      setRatesLoading(false);
    }
  }

  // ---------- CRUD ----------
  async function saveSettings(newSettings) {
    const payload = {
      id: 1,
      ...newSettings,
      pin: newSettings.pin || newSettings.pin1 || '1234',
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('kasa_settings').upsert(payload);
    if (!error) setSettings(payload);
    return !error;
  }

  function projectNameTaken(name, excludeId) {
    const trimmed = name.trim().toLowerCase();
    return projects.some((p) => p.id !== excludeId && p.name.trim().toLowerCase() === trimmed);
  }

  async function addProject(name) {
    const trimmed = name.trim();
    if (projectNameTaken(trimmed)) return { success: false, error: 'Bu isimde bir proje zaten var.' };
    const maxOrder = projects.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
    const row = { id: uid(), name: trimmed, is_general: false, sort_order: maxOrder + 1, created_at: new Date().toISOString() };
    const { error } = await supabase.from('kasa_projects').insert(row);
    if (error) return { success: false, error: 'Kaydedilemedi, tekrar deneyin.' };
    setProjects((prev) => [...prev, row]);
    return { success: true };
  }

  async function updateProjectName(id, name) {
    const trimmed = name.trim();
    if (projectNameTaken(trimmed, id)) return { success: false, error: 'Bu isimde bir proje zaten var.' };
    const { error } = await supabase.from('kasa_projects').update({ name: trimmed }).eq('id', id);
    if (error) return { success: false, error: 'Kaydedilemedi, tekrar deneyin.' };
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
    return { success: true };
  }

  async function reorderProjects(orderedIds) {
    setProjects((prev) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i + 1]));
      return prev.map((p) => (orderMap.has(p.id) ? { ...p, sort_order: orderMap.get(p.id) } : p));
    });
    await Promise.all(
      orderedIds.map((id, i) => supabase.from('kasa_projects').update({ sort_order: i + 1 }).eq('id', id))
    );
  }

  async function deleteProject(id) {
    const { error } = await supabase.from('kasa_projects').delete().eq('id', id);
    if (!error) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setTxns((prev) => prev.filter((t) => t.project_id !== id));
      setDebts((prev) => prev.filter((d) => d.project_id !== id));
    }
  }

  async function addTxn(entry) {
    const row = {
      id: uid(),
      project_id: entry.projectId,
      type: entry.type,
      amount: entry.amount,
      category: entry.category,
      description: entry.desc,
      party: entry.party || null,
      bank: entry.bank || null,
      txn_date: entry.date,
      added_by: entry.addedBy,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('kasa_transactions').insert(row);
    if (!error) setTxns((prev) => [...prev, row]);
    return !error;
  }

  async function addBank(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = banks.find((b) => b.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.name;
    const row = { id: uid(), name: trimmed, created_at: new Date().toISOString() };
    const { error } = await supabase.from('kasa_banks').insert(row);
    if (error) return null;
    setBanks((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
    return row.name;
  }

  async function updateTxn(id, entry) {
    const payload = {
      type: entry.type,
      amount: entry.amount,
      category: entry.category,
      description: entry.desc,
      party: entry.party || null,
      bank: entry.bank || null,
      txn_date: entry.date,
    };
    const { error } = await supabase.from('kasa_transactions').update(payload).eq('id', id);
    if (!error) setTxns((prev) => prev.map((t) => (t.id === id ? { ...t, ...payload } : t)));
    return !error;
  }

  async function deleteTxn(id) {
    const { error } = await supabase.from('kasa_transactions').delete().eq('id', id);
    if (!error) setTxns((prev) => prev.filter((t) => t.id !== id));
  }

  async function addDebt(entry) {
    const row = {
      id: uid(),
      project_id: entry.projectId,
      type: entry.type,
      amount: entry.amount,
      currency: entry.currency,
      party: entry.party,
      description: entry.desc,
      debt_date: entry.date,
      paid: false,
      added_by: entry.addedBy,
      rate_snapshot: entry.rateSnapshot ?? null,
      principal_amount: entry.principalAmount ?? null,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('kasa_debts').insert(row);
    if (error) return false;
    setDebts((prev) => [...prev, row]);

    if (entry.installmentCount && entry.firstDueDate) {
      const amounts = buildInstallmentAmounts(Number(entry.amount), entry.installmentCount);
      const instRows = amounts.map((amount, i) => ({
        id: uid(),
        debt_id: row.id,
        installment_no: i + 1,
        due_date: addMonthsToDateStr(entry.firstDueDate, i),
        amount,
        paid: false,
        paid_date: null,
        paid_by: null,
        created_at: new Date().toISOString(),
      }));
      const { error: instErr } = await supabase.from('kasa_debt_installments').insert(instRows);
      if (!instErr) setInstallments((prev) => [...prev, ...instRows]);
    }
    return true;
  }

  async function addDebtPayment(entry) {
    const row = {
      id: uid(),
      debt_id: entry.debtId,
      amount: entry.amount,
      description: entry.desc,
      payment_date: entry.date,
      added_by: entry.addedBy,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('kasa_debt_payments').insert(row);
    if (!error) setDebtPayments((prev) => [...prev, row]);
    return !error;
  }

  async function updateDebtPayment(id, entry) {
    const payload = { amount: entry.amount, description: entry.desc, payment_date: entry.date };
    const { error } = await supabase.from('kasa_debt_payments').update(payload).eq('id', id);
    if (!error) setDebtPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...payload } : p)));
    return !error;
  }

  async function deleteDebtPayment(id) {
    const { error } = await supabase.from('kasa_debt_payments').delete().eq('id', id);
    if (!error) setDebtPayments((prev) => prev.filter((p) => p.id !== id));
  }

  async function toggleInstallmentPaid(id) {
    const inst = installments.find((i) => i.id === id);
    if (!inst) return;
    const nowPaid = !inst.paid;
    const payload = { paid: nowPaid, paid_date: nowPaid ? todayStr() : null, paid_by: nowPaid ? currentUser : null };
    const { error } = await supabase.from('kasa_debt_installments').update(payload).eq('id', id);
    if (!error) setInstallments((prev) => prev.map((i) => (i.id === id ? { ...i, ...payload } : i)));
  }

  async function updateDebt(id, entry) {
    const payload = {
      type: entry.type,
      amount: entry.amount,
      currency: entry.currency,
      party: entry.party,
      description: entry.desc,
      debt_date: entry.date,
    };
    const { error } = await supabase.from('kasa_debts').update(payload).eq('id', id);
    if (!error) setDebts((prev) => prev.map((d) => (d.id === id ? { ...d, ...payload } : d)));
    return !error;
  }

  async function deleteDebt(id) {
    const { error } = await supabase.from('kasa_debts').delete().eq('id', id);
    if (!error) {
      setDebts((prev) => prev.filter((d) => d.id !== id));
      setDebtPayments((prev) => prev.filter((p) => p.debt_id !== id));
      setInstallments((prev) => prev.filter((i) => i.debt_id !== id));
    }
  }

  // ---------- Derived helpers ----------
  function totalsFor(projectId) {
    let income = 0, expense = 0;
    for (const t of txns) {
      if (projectId !== null && t.project_id !== projectId) continue;
      if (t.type === 'gelir') income += Number(t.amount); else expense += Number(t.amount);
    }
    return { income, expense, balance: income - expense };
  }

  function debtTotalsFor(projectId) {
    let alinan = 0, verilen = 0;
    for (const d of debts) {
      if (projectId !== null && d.project_id !== projectId) continue;
      const remaining = debtRemaining(d, debtPayments, installments);
      if (remaining <= 0) continue;
      const val = debtTRYValue({ amount: remaining, currency: d.currency, rate_snapshot: d.rate_snapshot }, rates);
      if (d.type === 'alinan') alinan += val; else verilen += val;
    }
    return { alinan, verilen, net: alinan - verilen };
  }

  function filteredTxns(projectId) {
    const sorted = [...txns]
      .filter((t) => t.project_id === projectId)
      .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || new Date(b.created_at) - new Date(a.created_at));
    if (filter === 'all') return sorted;
    return sorted.filter((t) => t.type === filter);
  }

  function filteredDebts(projectId) {
    const sorted = [...debts]
      .filter((d) => (projectId === null ? true : d.project_id === projectId))
      .sort((a, b) => b.debt_date.localeCompare(a.debt_date) || new Date(b.created_at) - new Date(a.created_at));
    if (debtFilter === 'all') return sorted;
    if (debtFilter === 'odenmemis') return sorted.filter((d) => !isDebtSettled(d, debtPayments, installments));
    if (debtFilter === 'taksitli') return sorted.filter((d) => debtInstallmentsFor(d, installments).length > 0);
    return sorted.filter((d) => d.type === debtFilter);
  }

  function shouldShowRateIssue() {
    return !!rates && invalidRateKeys(rates).length > 0 && !rateIssueDismissed;
  }

  const val = (id) => document.getElementById(id)?.value ?? '';

  // ================= RENDER =================

  if (loading) {
    return (
      <div id="kasa-app">
        <div className="kasa-loading">Defter açılıyor…</div>
      </div>
    );
  }

  if (connError) {
    return (
      <div id="kasa-app">
        <div className="kasa-center">
          <div className="kasa-auth-card">
            <h1>Bağlantı sorunu</h1>
            <p>
              Supabase&apos;e bağlanılamadı: <strong>{connError}</strong>. <code>.env.local</code> dosyasındaki
              NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY değerlerini ve <code>supabase/schema.sql</code>{' '}
              dosyasının çalıştırıldığını kontrol et.
            </p>
            <button className="kasa-save" onClick={loadAll}>Tekrar Dene</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="kasa-app">
      {view === 'setup' && <SetupScreen onSubmit={async (s) => { const ok = await saveSettings(s); if (ok) setView('login'); }} />}

      {view === 'login' && settings && (
        <LoginScreen
          settings={settings}
          onLogin={(name) => { setCurrentUser(name); saveSession(name); setView('overview'); }}
        />
      )}

      {view === 'overview' && settings && (
        <OverviewScreen
          settings={settings}
          projects={projects}
          currentUser={currentUser}
          totalsFor={totalsFor}
          debtTotalsFor={debtTotalsFor}
          onOpenProject={(id) => { setActiveProjectId(id); setProjectTab('hareketler'); setFilter('all'); setView('project'); }}
          onGotoDebts={() => { setDebtFilter('all'); setView('debts'); }}
          onLogout={() => { setCurrentUser(null); clearSession(); setView('login'); }}
          onOpenSettings={() => setSettingsOpen(true)}
          onNewProject={() => setNewProjectOpen(true)}
          onEditProject={(project) => setEditProjectTarget(project)}
          onReorderProjects={reorderProjects}
          onDeleteProject={(id, name) => setConfirmModal({
            message: `"${name}" projesini ve tüm kayıtlarını silmek istediğinize emin misiniz?`,
            onYes: () => deleteProject(id),
          })}
        />
      )}

      {view === 'project' && settings && (
        <ProjectScreen
          settings={settings}
          project={projects.find((p) => p.id === activeProjectId)}
          projects={projects}
          currentUser={currentUser}
          totals={totalsFor(activeProjectId)}
          debtTotals={debtTotalsFor(activeProjectId)}
          txns={filteredTxns(activeProjectId)}
          debts={filteredDebts(activeProjectId)}
          debtPayments={debtPayments}
          installments={installments}
          banks={banks}
          onAddBank={addBank}
          filter={filter} setFilter={setFilter}
          formType={formType} setFormType={setFormType}
          projectTab={projectTab} setProjectTab={setProjectTab}
          debtFormType={debtFormType} setDebtFormType={setDebtFormType}
          debtFilter={debtFilter} setDebtFilter={setDebtFilter}
          rates={rates} ratesLoading={ratesLoading} onRefreshRates={refreshRates}
          showRateIssue={projectTab === 'borclar' && shouldShowRateIssue()}
          rateIssueAttempted={rateIssueAttempted}
          onRetryRates={async () => { await refreshRates(); setRateIssueAttempted(true); }}
          onCloseRateIssue={() => { setRateIssueDismissed(true); setRateIssueAttempted(false); }}
          onBack={() => setView('overview')}
          onLogout={() => { setCurrentUser(null); clearSession(); setView('login'); }}
          onAddTxn={async (entry) => { await addTxn({ ...entry, addedBy: currentUser }); }}
          onEditTxn={setEditTxnTarget}
          onDeleteTxn={deleteTxn}
          onAddDebt={async (entry) => { await addDebt({ ...entry, projectId: activeProjectId, addedBy: currentUser }); }}
          onOpenPayments={setPaymentDebtId}
          onEditDebt={setEditDebtTarget}
          onDeleteDebt={(id) => setConfirmModal({ message: 'Bu borç kaydını silmek istediğinize emin misiniz?', onYes: () => deleteDebt(id) })}
        />
      )}

      {view === 'debts' && settings && (
        <CompanyDebtsScreen
          settings={settings}
          projects={projects}
          currentUser={currentUser}
          debts={filteredDebts(null)}
          debtPayments={debtPayments}
          installments={installments}
          debtFormType={debtFormType} setDebtFormType={setDebtFormType}
          debtFilter={debtFilter} setDebtFilter={setDebtFilter}
          debtTotals={debtTotalsFor(null)}
          rates={rates} ratesLoading={ratesLoading} onRefreshRates={refreshRates}
          showRateIssue={shouldShowRateIssue()}
          rateIssueAttempted={rateIssueAttempted}
          onRetryRates={async () => { await refreshRates(); setRateIssueAttempted(true); }}
          onCloseRateIssue={() => { setRateIssueDismissed(true); setRateIssueAttempted(false); }}
          onBack={() => setView('overview')}
          onLogout={() => { setCurrentUser(null); clearSession(); setView('login'); }}
          onAddDebt={async (entry) => { await addDebt({ ...entry, addedBy: currentUser }); }}
          onOpenPayments={setPaymentDebtId}
          onEditDebt={setEditDebtTarget}
          onDeleteDebt={(id) => setConfirmModal({ message: 'Bu borç kaydını silmek istediğinize emin misiniz?', onYes: () => deleteDebt(id) })}
        />
      )}

      {paymentDebtId && debtInstallmentsFor({ id: paymentDebtId }, installments).length > 0 && (
        <InstallmentModal
          debt={debts.find((d) => d.id === paymentDebtId)}
          installments={debtInstallmentsFor({ id: paymentDebtId }, installments)}
          onTogglePaid={toggleInstallmentPaid}
          onClose={() => setPaymentDebtId(null)}
        />
      )}

      {paymentDebtId && debtInstallmentsFor({ id: paymentDebtId }, installments).length === 0 && (
        <PaymentModal
          debt={debts.find((d) => d.id === paymentDebtId)}
          payments={debtPayments.filter((p) => p.debt_id === paymentDebtId)}
          rates={rates}
          onAddPayment={async (amount, date, desc) => { await addDebtPayment({ debtId: paymentDebtId, amount, date, desc, addedBy: currentUser }); }}
          onEditPayment={updateDebtPayment}
          onDeletePayment={(id) => setConfirmModal({ message: 'Bu ödeme kaydını silmek istediğinize emin misiniz?', onYes: () => deleteDebtPayment(id) })}
          onClose={() => setPaymentDebtId(null)}
        />
      )}

      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          currentUser={currentUser}
          onClose={() => setSettingsOpen(false)}
          onSave={async (s) => {
            const ok = await saveSettings(s);
            if (ok) {
              setSettingsOpen(false);
              if (currentUser === settings.user1) { setCurrentUser(s.user1); saveSession(s.user1); }
              else if (currentUser === settings.user2) { setCurrentUser(s.user2); saveSession(s.user2); }
            }
          }}
        />
      )}

      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreate={async (name) => {
            const result = await addProject(name);
            if (result.success) setNewProjectOpen(false);
            return result;
          }}
        />
      )}

      {editProjectTarget && (
        <EditProjectModal
          project={editProjectTarget}
          onClose={() => setEditProjectTarget(null)}
          onSave={async (name) => {
            const result = await updateProjectName(editProjectTarget.id, name);
            if (result.success) setEditProjectTarget(null);
            return result;
          }}
        />
      )}

      {editDebtTarget && (
        <EditDebtModal
          debt={editDebtTarget}
          onClose={() => setEditDebtTarget(null)}
          onSave={async (entry) => {
            const ok = await updateDebt(editDebtTarget.id, entry);
            if (ok) setEditDebtTarget(null);
            return ok;
          }}
        />
      )}

      {editTxnTarget && (
        <EditTxnModal
          txn={editTxnTarget}
          banks={banks}
          onClose={() => setEditTxnTarget(null)}
          onSave={async (entry) => {
            const ok = await updateTxn(editTxnTarget.id, entry);
            if (ok) setEditTxnTarget(null);
            return ok;
          }}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          onNo={() => setConfirmModal(null)}
          onYes={async () => { const action = confirmModal.onYes; setConfirmModal(null); await action(); }}
        />
      )}
    </div>
  );
}

// ================= Sub-screens =================

function SetupScreen({ onSubmit }) {
  const [error, setError] = useState('');
  return (
    <div className="kasa-center">
      <div className="kasa-auth-card" style={{ maxWidth: 440 }}>
        <h1>Kasa Defterine Hoş Geldin</h1>
        <p>İlk kurulum — şirket bilgilerinizi ve her kullanıcı için ayrı güvenlik PIN&apos;i belirleyin.</p>
        <label className="kasa-field">Şirket / işletme adı</label>
        <input className="kasa-input" id="s-company" placeholder="Örn. Yılmaz Kardeşler" />

        <div className="kasa-settings-row">
          <div style={{ flex: 1 }}>
            <label className="kasa-field">1. Kullanıcı adı</label>
            <input className="kasa-input" id="s-user1" placeholder="Örn. Ali" />
          </div>
          <div style={{ width: 110 }}>
            <label className="kasa-field">1. PIN</label>
            <input className="kasa-input" id="s-pin1" maxLength={4} inputMode="numeric" placeholder="1234" />
          </div>
        </div>

        <div className="kasa-settings-row" style={{ marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <label className="kasa-field">2. Kullanıcı adı</label>
            <input className="kasa-input" id="s-user2" placeholder="Örn. Veli" />
          </div>
          <div style={{ width: 110 }}>
            <label className="kasa-field">2. PIN</label>
            <input className="kasa-input" id="s-pin2" maxLength={4} inputMode="numeric" placeholder="5678" />
          </div>
        </div>

        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          style={{ marginTop: 16 }}
          onClick={() => {
            const company = document.getElementById('s-company').value.trim();
            const u1 = document.getElementById('s-user1').value.trim();
            const pin1 = document.getElementById('s-pin1').value.trim();
            const u2 = document.getElementById('s-user2').value.trim();
            const pin2 = document.getElementById('s-pin2').value.trim();
            if (!company || !u1 || !u2 || !/^\d{4}$/.test(pin1) || !/^\d{4}$/.test(pin2)) {
              setError('Lütfen tüm alanları doldurun, PIN\'ler 4 haneli rakam olmalı.');
              return;
            }
            onSubmit({ company_name: company, user1: u1, pin1, user2: u2, pin2 });
          }}
        >
          Kurulumu Tamamla
        </button>
      </div>
    </div>
  );
}

function LoginScreen({ settings, onLogin }) {
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const names = [settings.user1, settings.user2];
  const userPins = [settings.pin1 || settings.pin, settings.pin2 || settings.pin];
  return (
    <div className="kasa-center">
      <div className="kasa-auth-card">
        <h1>{settings.company_name}</h1>
        <p>Kasa defterine erişmek için kim olduğunuzu seçin ve kendi PIN&apos;inizi girin.</p>
        <div>
          {names.map((name, i) => (
            <button
              key={i}
              className="kasa-name-btn"
              style={{ borderColor: selected === i ? 'var(--gold)' : 'var(--line)' }}
              onClick={() => { setSelected(i); setError(''); }}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="kasa-field">PIN Şifreniz</label>
        <input className="kasa-input" id="l-pin" maxLength={4} inputMode="numeric" placeholder="••••" />
        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          style={{ marginTop: 14 }}
          onClick={() => {
            const pin = document.getElementById('l-pin').value.trim();
            if (selected === null) { setError('Lütfen isminizi seçin.'); return; }
            const expectedPin = userPins[selected];
            if (pin !== expectedPin) { setError('PIN hatalı.'); return; }
            onLogin(names[selected]);
          }}
        >
          Giriş Yap
        </button>
      </div>
    </div>
  );
}

function OverviewScreen({ settings, projects, currentUser, totalsFor, debtTotalsFor, onOpenProject, onGotoDebts, onLogout, onOpenSettings, onNewProject, onEditProject, onReorderProjects, onDeleteProject }) {
  const grand = totalsFor(null);
  const grandDebt = debtTotalsFor(null);
  const [draggedId, setDraggedId] = useState(null);
  const sortedProjects = [...projects].sort((a, b) => {
    if (a.is_general !== b.is_general) return a.is_general ? -1 : 1;
    return (a.sort_order || 0) - (b.sort_order || 0) || a.created_at.localeCompare(b.created_at);
  });

  function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return; }
    const orderable = sortedProjects.filter((p) => !p.is_general).map((p) => p.id);
    const from = orderable.indexOf(draggedId);
    const to = orderable.indexOf(targetId);
    if (from === -1 || to === -1) { setDraggedId(null); return; }
    orderable.splice(from, 1);
    orderable.splice(to, 0, draggedId);
    onReorderProjects(orderable);
    setDraggedId(null);
  }

  return (
    <div className="kasa-wrap">
      <div className="kasa-topbar">
        <div>
          <h1 className="kasa-h1">{settings.company_name}</h1>
          <div className="kasa-sub">Tüm Projeler — Genel Kasa</div>
        </div>
        <div className="kasa-user-chip">
          👤 {currentUser}
          <button onClick={onOpenSettings}>Ayarlar</button>
          <button onClick={onLogout}>Çıkış</button>
        </div>
      </div>

      <div className="kasa-stats">
        <div className="kasa-stat main">
          <div className="kasa-seal"></div>
          <p className="kasa-stat-label">Genel Toplam Bakiye</p>
          <p className="kasa-stat-value">{fmtMoney(grand.balance)}</p>
        </div>
        <div className="kasa-stat income">
          <p className="kasa-stat-label">Genel Toplam Gelir</p>
          <p className="kasa-stat-value">{fmtMoney(grand.income)}</p>
        </div>
        <div className="kasa-stat expense">
          <p className="kasa-stat-label">Genel Toplam Gider</p>
          <p className="kasa-stat-value">{fmtMoney(grand.expense)}</p>
        </div>
      </div>

      <div className="kasa-section-head">
        <h2>Borç Durumu</h2>
        <button className="kasa-add-project" onClick={onGotoDebts}>Borçları Görüntüle →</button>
      </div>
      <div className="kasa-stats">
        <div className="kasa-stat expense">
          <p className="kasa-stat-label">Ödenmemiş Borç (Aldığımız)</p>
          <p className="kasa-stat-value">{fmtMoney(grandDebt.alinan)}</p>
        </div>
        <div className="kasa-stat income">
          <p className="kasa-stat-label">Ödenmemiş Alacak (Verdiğimiz)</p>
          <p className="kasa-stat-value">{fmtMoney(grandDebt.verilen)}</p>
        </div>
        <div className="kasa-stat main">
          <div className="kasa-seal"></div>
          <p className="kasa-stat-label">Net Borç Durumu</p>
          <p className="kasa-stat-value" style={{ color: grandDebt.net > 0 ? 'var(--expense)' : 'var(--income)' }}>{fmtMoney(grandDebt.net)}</p>
        </div>
      </div>

      <div className="kasa-section-head">
        <h2>Projeler</h2>
        <button className="kasa-add-project" onClick={onNewProject}>+ Yeni Proje</button>
      </div>

      {projects.length === 0 ? (
        <div className="kasa-empty-proj">Henüz proje yok. &quot;+ Yeni Proje&quot; ile ilk projenizi oluşturun.</div>
      ) : (
        <div className="kasa-projects-grid">
          {sortedProjects.map((p) => {
            const t = totalsFor(p.id);
            const dt = debtTotalsFor(p.id);
            const hasDebt = dt.alinan > 0 || dt.verilen > 0;
            return (
              <div
                key={p.id}
                className={`kasa-project-card${draggedId === p.id ? ' dragging' : ''}`}
                role="button"
                tabIndex={0}
                draggable={!p.is_general}
                onDragStart={() => setDraggedId(p.id)}
                onDragOver={(e) => { if (!p.is_general) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (!p.is_general) handleDrop(p.id); }}
                onDragEnd={() => setDraggedId(null)}
                onClick={() => onOpenProject(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProject(p.id); } }}
              >
                <div className="kasa-project-left">
                  <p className="kasa-project-name">
                    {p.name} {p.is_general && <span className="kasa-general-tag">GENEL</span>}
                  </p>
                  <p className="kasa-project-meta">Gelir {fmtMoney(t.income)} · Gider {fmtMoney(t.expense)}</p>
                  {hasDebt && (
                    <p className="kasa-project-debt">
                      {dt.alinan > 0 ? `Borç ${fmtMoney(dt.alinan)}` : ''}
                      {dt.alinan > 0 && dt.verilen > 0 ? ' · ' : ''}
                      {dt.verilen > 0 ? `Alacak ${fmtMoney(dt.verilen)}` : ''}
                    </p>
                  )}
                </div>
                <div className="kasa-project-right">
                  <p className="kasa-project-bal" style={{ color: t.balance >= 0 ? 'var(--income)' : 'var(--expense)' }}>{fmtMoney(t.balance)}</p>
                  {!p.is_general && (
                    <>
                      <button
                        className="kasa-project-edit"
                        title="Proje adını düzenle"
                        onClick={(e) => { e.stopPropagation(); onEditProject(p); }}
                      >
                        ✎
                      </button>
                      <button
                        className="kasa-project-del"
                        title="Projeyi sil"
                        onClick={(e) => { e.stopPropagation(); onDeleteProject(p.id, p.name); }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RatesBar({ rates, ratesLoading, onRefresh }) {
  if (!rates) {
    return (
      <div className="kasa-rates-bar">
        <span>Kur bilgisi henüz alınmadı.</span>
        <button onClick={onRefresh} disabled={ratesLoading}>{ratesLoading ? 'Alınıyor…' : 'Şimdi Al'}</button>
      </div>
    );
  }
  const updated = rates.fetched_at
    ? new Date(rates.fetched_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
  return (
    <div className="kasa-rates-bar">
      <span>1 USD ≈ {fmtMoney(rates.usd)}</span>
      <span>1 EUR ≈ {fmtMoney(rates.eur)}</span>
      <span>Gram Altın ≈ {fmtMoney(rates.gram_altin)}</span>
      <span>Çeyrek Altın ≈ {fmtMoney(rates.ceyrek_altin)}</span>
      <span>Tam Altın ≈ {fmtMoney(rates.tam_altin)}</span>
      <span>Cumhuriyet Altını ≈ {fmtMoney(rates.cumhuriyet_altini)}</span>
      <span>Ata Altın ≈ {fmtMoney(rates.ata_altin)}</span>
      <span>22 Ayar Bilezik (gr) ≈ {fmtMoney(rates.ayar_bilezik)}</span>
      <span className="kasa-rates-updated">Güncelleme: {updated}</span>
      <button onClick={onRefresh} disabled={ratesLoading}>{ratesLoading ? 'Alınıyor…' : 'Yenile'}</button>
    </div>
  );
}

function RateIssueModal({ rates, attempted, onRetry, onClose, loading }) {
  const bad = invalidRateKeys(rates);
  const names = bad.map((k) => (CURRENCIES[k] ? CURRENCIES[k].label : k)).join(', ');
  if (attempted) {
    return (
      <div className="kasa-modal-overlay">
        <div className="kasa-auth-card" style={{ maxWidth: 420 }}>
          <h1>Kur bilgisi alınamadı</h1>
          <p>Yeniden denendi ama şu değerler hâlâ alınamadı: <strong>{names}</strong>. Bu muhtemelen teknik bir sorun — bu değerleri borç girerken tahmini olarak elle girmeniz gerekebilir.</p>
          <button className="kasa-save" onClick={onClose}>Anladım, Kapat</button>
        </div>
      </div>
    );
  }
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 420 }}>
        <h1>Bazı kur bilgileri eksik</h1>
        <p>Şu değerler için güncel fiyat alınamadı: <strong>{names}</strong>. Lütfen kuru yeniden almayı deneyin.</p>
        <button className="kasa-save" onClick={onRetry} disabled={loading}>{loading ? 'Alınıyor…' : 'Kuru Yenile'}</button>
      </div>
    </div>
  );
}

function DebtForm({ projects, showProjectSelect, debtFormType, setDebtFormType, rates, onAdd }) {
  const [error, setError] = useState('');
  const [installmentOn, setInstallmentOn] = useState(false);
  const [currency, setCurrency] = useState('TRY');
  const [date, setDate] = useState(todayStr());
  const isForeign = currency !== 'TRY';
  const liveRate = rates ? rates[currency.toLowerCase()] : null;

  return (
    <div className="kasa-panel">
      <h2>Borç Ekle</h2>
      <div className="kasa-fis">
        <div className="kasa-toggle">
          <button className={`alinan ${debtFormType === 'alinan' ? 'active alinan' : ''}`} onClick={() => setDebtFormType('alinan')}>Aldığımız Borç</button>
          <button className={`verilen ${debtFormType === 'verilen' ? 'active verilen' : ''}`} onClick={() => setDebtFormType('verilen')}>Verdiğimiz Borç</button>
        </div>
        {showProjectSelect && (
          <>
            <label className="kasa-field">Proje</label>
            <select className="kasa-select" id="d-project" defaultValue={projects.find((p) => p.is_general)?.id}>
              {[...projects].sort((a, b) => (b.is_general ? 1 : 0) - (a.is_general ? 1 : 0)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.is_general ? ' (Genel)' : ''}</option>
              ))}
            </select>
          </>
        )}
        <label className="kasa-field">Para Birimi</label>
        <select className="kasa-select" id="d-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {Object.entries(CURRENCIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="kasa-field">{CURRENCIES[currency].unit ? `Tutar (${CURRENCIES[currency].unit})` : 'Tutar'}</label>
        <input className="kasa-input" id="d-amount" type="number" min="0" step="0.01" placeholder="0.00" />
        <label className="kasa-field">{debtFormType === 'alinan' ? 'Kimden alındı' : 'Kime verildi'}</label>
        <input className="kasa-input" id="d-party" placeholder="Örn. Ahmet Usta / Banka" />
        <label className="kasa-field">Açıklama</label>
        <input className="kasa-input" id="d-desc" placeholder="Örn. Malzeme avansı" />
        <label className="kasa-field">Tarih</label>
        <input className="kasa-input" id="d-date" type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} />

        {isForeign && (
          <>
            <label className="kasa-field">Kur (₺) — opsiyonel</label>
            <input className="kasa-input" id="d-rate" type="number" min="0" step="0.0001" placeholder={liveRate ? String(liveRate) : '0.00'} />
            <p style={{ fontSize: 11, color: 'var(--ink-soft)', margin: '4px 0 0' }}>
              {date === todayStr()
                ? 'Boş bırakırsan bugünün güncel kuru otomatik kaydedilir ve bu borç için bir daha değişmez.'
                : 'Geçmiş tarihli borç: o günün kurunu biliyorsan buraya elle gir, bilmiyorsan boş bırak (güncel kur kullanılır).'}
            </p>
          </>
        )}

        <label className="kasa-checkbox-row">
          <input type="checkbox" id="d-installment-on" checked={installmentOn} onChange={(e) => setInstallmentOn(e.target.checked)} />
          Taksitli (Kredi)
        </label>
        {installmentOn && (
          <>
            <label className="kasa-field">Taksit Sayısı</label>
            <input className="kasa-input" id="d-installment-count" type="number" min="2" step="1" placeholder="Örn. 12" />
            <label className="kasa-field">İlk Taksit Tarihi</label>
            <input className="kasa-input" id="d-installment-date" type="date" defaultValue={todayStr()} />
            <label className="kasa-field">Ana Para — opsiyonel</label>
            <input className="kasa-input" id="d-principal" type="number" min="0" step="0.01" placeholder="Faizsiz asıl tutar" />
            <p style={{ fontSize: 11, color: 'var(--ink-soft)', margin: '4px 0 0' }}>
              Girersen, toplam tutar ile ana para arasındaki fark faiz olarak gösterilir.
            </p>
          </>
        )}

        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          onClick={() => {
            const amount = parseFloat(document.getElementById('d-amount').value);
            const party = document.getElementById('d-party').value.trim();
            const desc = document.getElementById('d-desc').value.trim();
            const projSelect = document.getElementById('d-project');
            if (!amount || amount <= 0) { setError('Geçerli bir tutar girin.'); return; }
            if (!party) { setError('Kimden/kime bilgisini girin.'); return; }

            let rateSnapshot = null;
            if (isForeign) {
              const manualRate = parseFloat(document.getElementById('d-rate')?.value);
              if (!isNaN(manualRate) && manualRate > 0) rateSnapshot = manualRate;
              else if (date === todayStr() && liveRate) rateSnapshot = Number(liveRate);
            }

            let installmentCount = null;
            let firstDueDate = null;
            let principalAmount = null;
            if (installmentOn) {
              installmentCount = parseInt(document.getElementById('d-installment-count').value, 10);
              firstDueDate = document.getElementById('d-installment-date').value || todayStr();
              if (!installmentCount || installmentCount < 2) { setError('Taksit sayısı en az 2 olmalı.'); return; }
              const principalInput = parseFloat(document.getElementById('d-principal')?.value);
              if (!isNaN(principalInput) && principalInput > 0) principalAmount = principalInput;
            }
            setError('');
            onAdd({
              type: debtFormType, amount, currency, party, desc, date,
              rateSnapshot, installmentCount, firstDueDate, principalAmount,
              projectId: projSelect ? projSelect.value : undefined,
            });
            document.getElementById('d-amount').value = '';
            document.getElementById('d-party').value = '';
            document.getElementById('d-desc').value = '';
            setInstallmentOn(false);
            setCurrency('TRY');
            setDate(todayStr());
          }}
        >
          Kaydet
        </button>
      </div>
    </div>
  );
}

function ProjectScreen(props) {
  const {
    settings, project, projects, currentUser, totals, debtTotals, txns, debts, debtPayments, installments,
    banks, onAddBank,
    filter, setFilter, formType, setFormType, projectTab, setProjectTab,
    debtFormType, setDebtFormType, debtFilter, setDebtFilter,
    rates, ratesLoading, onRefreshRates, showRateIssue, rateIssueAttempted, onRetryRates, onCloseRateIssue,
    onBack, onLogout, onAddTxn, onEditTxn, onDeleteTxn, onAddDebt, onOpenPayments, onEditDebt, onDeleteDebt,
  } = props;

  const [txnError, setTxnError] = useState('');
  const [addBankOpen, setAddBankOpen] = useState(false);
  const [txnPartySearch, setTxnPartySearch] = useState('');
  if (!project) return null;
  const cats = CATS_GELIR;

  return (
    <div className="kasa-wrap">
      <button className="kasa-back" onClick={onBack}>← Tüm Projeler</button>
      <div className="kasa-topbar">
        <div>
          <h1 className="kasa-h1">{project.name}</h1>
          <div className="kasa-sub">{settings.company_name} · Proje Kasası</div>
        </div>
        <div className="kasa-user-chip">
          👤 {currentUser}
          <button onClick={onLogout}>Çıkış</button>
        </div>
      </div>

      <div className="kasa-stats">
        <div className="kasa-stat main">
          <div className="kasa-seal"></div>
          <p className="kasa-stat-label">Kasa Bakiyesi</p>
          <p className="kasa-stat-value">{fmtMoney(totals.balance)}</p>
        </div>
        <div className="kasa-stat income">
          <p className="kasa-stat-label">Toplam Gelir</p>
          <p className="kasa-stat-value">{fmtMoney(totals.income)}</p>
        </div>
        <div className="kasa-stat expense">
          <p className="kasa-stat-label">Toplam Gider</p>
          <p className="kasa-stat-value">{fmtMoney(totals.expense)}</p>
        </div>
      </div>

      {(debtTotals.alinan > 0 || debtTotals.verilen > 0) && (
        <div className="kasa-project-debt-banner">
          {debtTotals.alinan > 0 && <span>Ödenmemiş Borç: <strong>{fmtMoney(debtTotals.alinan)}</strong></span>}
          {debtTotals.verilen > 0 && <span>Ödenmemiş Alacak: <strong>{fmtMoney(debtTotals.verilen)}</strong></span>}
          <button className="kasa-link" onClick={() => setProjectTab('borclar')}>Borçları Görüntüle →</button>
        </div>
      )}

      <div className="kasa-tabs">
        <button className={projectTab !== 'borclar' ? 'active' : ''} onClick={() => setProjectTab('hareketler')}>Kasa Hareketleri</button>
        <button className={projectTab === 'borclar' ? 'active' : ''} onClick={() => setProjectTab('borclar')}>Borçlar</button>
      </div>

      {projectTab === 'borclar' ? (
        <>
          <div className="kasa-stats">
            <div className="kasa-stat expense">
              <p className="kasa-stat-label">Ödenmemiş Borç (Aldığımız)</p>
              <p className="kasa-stat-value">{fmtMoney(debtTotals.alinan)}</p>
            </div>
            <div className="kasa-stat income">
              <p className="kasa-stat-label">Ödenmemiş Alacak (Verdiğimiz)</p>
              <p className="kasa-stat-value">{fmtMoney(debtTotals.verilen)}</p>
            </div>
            <div className="kasa-stat main">
              <div className="kasa-seal"></div>
              <p className="kasa-stat-label">Net Borç</p>
              <p className="kasa-stat-value" style={{ color: debtTotals.net > 0 ? 'var(--expense)' : 'var(--income)' }}>{fmtMoney(debtTotals.net)}</p>
            </div>
          </div>
          <RatesBar rates={rates} ratesLoading={ratesLoading} onRefresh={onRefreshRates} />
          <div className="kasa-grid">
            <DebtForm projects={projects} showProjectSelect={false} debtFormType={debtFormType} setDebtFormType={setDebtFormType} rates={rates} onAdd={onAddDebt} />
            <DebtListWithRates debts={debts} debtPayments={debtPayments} installments={installments} projects={projects} rates={rates} debtFilter={debtFilter} setDebtFilter={setDebtFilter} showProjectTag={false} onOpenPayments={onOpenPayments} onEdit={onEditDebt} onDelete={onDeleteDebt} />
          </div>
          {showRateIssue && (
            <RateIssueModal rates={rates} attempted={rateIssueAttempted} onRetry={onRetryRates} onClose={onCloseRateIssue} loading={ratesLoading} />
          )}
        </>
      ) : (
        <div className="kasa-grid">
          <div className="kasa-panel">
            <h2>Fiş Kes</h2>
            <div className="kasa-fis">
              <div className="kasa-toggle">
                <button className={`gelir ${formType === 'gelir' ? 'active gelir' : ''}`} onClick={() => setFormType('gelir')}>+ Gelir</button>
                <button className={`gider ${formType === 'gider' ? 'active gider' : ''}`} onClick={() => setFormType('gider')}>− Gider</button>
              </div>
              <label className="kasa-field">Tutar (₺)</label>
              <input className="kasa-input" id="f-amount" type="number" min="0" step="0.01" placeholder="0.00" />
              {formType === 'gider' ? (
                <>
                  <label className="kasa-field">Kime</label>
                  <input className="kasa-input" id="f-party" placeholder="Örn. Ahmet Usta / Belediye" />
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <label className="kasa-field" style={{ margin: '10px 0 5px' }}>Banka</label>
                    <button
                      type="button"
                      className="kasa-link"
                      style={{ margin: 0 }}
                      onClick={() => setAddBankOpen(true)}
                    >
                      + Yeni Banka Ekle
                    </button>
                  </div>
                  <select
                    className="kasa-select"
                    id="f-bank"
                    defaultValue={banks.find((b) => b.name === 'Nakit') ? 'Nakit' : ''}
                  >
                    {banks.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <label className="kasa-field">Kategori</label>
                  <select className="kasa-select" id="f-cat">
                    {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </>
              )}
              <label className="kasa-field">Açıklama</label>
              <input className="kasa-input" id="f-desc" placeholder="Örn. Ocak ayı kira" />
              <label className="kasa-field">Tarih</label>
              <input className="kasa-input" id="f-date" type="date" defaultValue={todayStr()} />
              {txnError && <div className="kasa-error">{txnError}</div>}
              <button
                className="kasa-save"
                onClick={() => {
                  const amount = parseFloat(document.getElementById('f-amount').value);
                  const catSelect = document.getElementById('f-cat');
                  const category = formType === 'gelir' && catSelect ? catSelect.value : null;
                  const partyInput = document.getElementById('f-party');
                  const party = formType === 'gider' && partyInput ? partyInput.value.trim() : null;
                  const bankSelect = document.getElementById('f-bank');
                  const bank = formType === 'gider' && bankSelect ? bankSelect.value : null;
                  const desc = document.getElementById('f-desc').value.trim();
                  const date = document.getElementById('f-date').value || todayStr();
                  if (!amount || amount <= 0) { setTxnError('Geçerli bir tutar girin.'); return; }
                  if (formType === 'gider' && !party) { setTxnError('Kime ödendiğini girin.'); return; }
                  setTxnError('');
                  onAddTxn({ projectId: project.id, type: formType, amount, category, party, bank, desc, date });
                  document.getElementById('f-amount').value = '';
                  if (partyInput) partyInput.value = '';
                  document.getElementById('f-desc').value = '';
                }}
              >
                Kaydet
              </button>
            </div>
          </div>

          <div className="kasa-panel">
            <h2>Hareketler</h2>
            <div className="kasa-filters">
              <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Hepsi</button>
              <button className={filter === 'gelir' ? 'active' : ''} onClick={() => setFilter('gelir')}>Gelirler</button>
              <button className={filter === 'gider' ? 'active' : ''} onClick={() => setFilter('gider')}>Giderler</button>
            </div>
            <input
              className="kasa-input"
              list="txn-party-list"
              placeholder="Kime ödendi ara (yaz veya listeden seç)..."
              value={txnPartySearch}
              onChange={(e) => setTxnPartySearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <datalist id="txn-party-list">
              {[...new Set(txns.map((t) => t.party).filter(Boolean))].sort().map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <div>
              {(() => {
                const search = txnPartySearch.trim().toLowerCase();
                const searchedTxns = search ? txns.filter((t) => (t.party || '').toLowerCase().includes(search)) : txns;
                if (searchedTxns.length === 0) {
                  return <div className="kasa-empty">{search ? 'Bu aramaya uyan kayıt yok.' : 'Henüz kayıt yok. Soldaki formdan ilk fişi kesin.'}</div>;
                }
                return (
                  <>
                    {searchedTxns.map((t) => (
                      <div className="kasa-row" key={t.id}>
                        <div className="kasa-row-date">{fmtDate(t.txn_date)}</div>
                        <div>
                          <div className="kasa-row-desc">
                            {t.type === 'gider' ? (t.party || t.description || t.category) : (t.description || t.category)}
                          </div>
                          <div className="kasa-row-cat">
                            {t.type === 'gider'
                              ? <>{t.party && t.description ? t.description + ' · ' : ''}{t.bank ? t.bank + ' · ' : ''}</>
                              : <>{t.category} · </>}
                            <span className="kasa-row-by">{t.added_by}</span>
                          </div>
                        </div>
                        <div className={`kasa-stamp ${t.type}`}>{t.type === 'gelir' ? '+' : '−'} {fmtMoney(t.amount)}</div>
                        <button className="kasa-project-edit" title="Düzenle" onClick={() => onEditTxn(t)}>✎</button>
                        <button className="kasa-del" title="Sil" onClick={() => onDeleteTxn(t.id)}>✕</button>
                      </div>
                    ))}
                    {search && (
                      <div className="kasa-search-total">
                        <span>Bu aramada toplam ödenen <strong>{fmtMoney(searchedTxns.filter((t) => t.type === 'gider').reduce((s, t) => s + Number(t.amount), 0))}</strong></span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {addBankOpen && (
        <AddBankModal
          onClose={() => setAddBankOpen(false)}
          onCreate={async (name) => {
            const created = await onAddBank(name);
            setAddBankOpen(false);
            if (created) {
              const bankSelect = document.getElementById('f-bank');
              if (bankSelect) bankSelect.value = created;
            }
          }}
        />
      )}
    </div>
  );
}

function CompanyDebtsScreen(props) {
  const {
    settings, projects, currentUser, debts, debtPayments, installments, debtFormType, setDebtFormType, debtFilter, setDebtFilter,
    debtTotals, rates, ratesLoading, onRefreshRates, showRateIssue, rateIssueAttempted, onRetryRates, onCloseRateIssue,
    onBack, onLogout, onAddDebt, onOpenPayments, onEditDebt, onDeleteDebt,
  } = props;

  return (
    <div className="kasa-wrap">
      <button className="kasa-back" onClick={onBack}>← Tüm Projeler</button>
      <div className="kasa-topbar">
        <div>
          <h1 className="kasa-h1">Borçlar</h1>
          <div className="kasa-sub">{settings.company_name} · Tüm Projeler Geneli</div>
        </div>
        <div className="kasa-user-chip">
          👤 {currentUser}
          <button onClick={onLogout}>Çıkış</button>
        </div>
      </div>
      <div className="kasa-stats">
        <div className="kasa-stat expense">
          <p className="kasa-stat-label">Ödenmemiş Borç (Aldığımız)</p>
          <p className="kasa-stat-value">{fmtMoney(debtTotals.alinan)}</p>
        </div>
        <div className="kasa-stat income">
          <p className="kasa-stat-label">Ödenmemiş Alacak (Verdiğimiz)</p>
          <p className="kasa-stat-value">{fmtMoney(debtTotals.verilen)}</p>
        </div>
        <div className="kasa-stat main">
          <div className="kasa-seal"></div>
          <p className="kasa-stat-label">Net Borç</p>
          <p className="kasa-stat-value" style={{ color: debtTotals.net > 0 ? 'var(--expense)' : 'var(--income)' }}>{fmtMoney(debtTotals.net)}</p>
        </div>
      </div>
      <RatesBar rates={rates} ratesLoading={ratesLoading} onRefresh={onRefreshRates} />
      <div className="kasa-grid">
        <DebtForm projects={projects} showProjectSelect={true} debtFormType={debtFormType} setDebtFormType={setDebtFormType} rates={rates} onAdd={onAddDebt} />
        <DebtListWithRates debts={debts} debtPayments={debtPayments} installments={installments} projects={projects} rates={rates} debtFilter={debtFilter} setDebtFilter={setDebtFilter} showProjectTag={true} onOpenPayments={onOpenPayments} onEdit={onEditDebt} onDelete={onDeleteDebt} />
      </div>
      {showRateIssue && (
        <RateIssueModal rates={rates} attempted={rateIssueAttempted} onRetry={onRetryRates} onClose={onCloseRateIssue} loading={ratesLoading} />
      )}
    </div>
  );
}

// DebtList variant that has access to `rates` for TRY conversion display
function formatCurrencyAmount(amount, currency) {
  const meta = currencyMeta(currency);
  if (!currency || currency === 'TRY') return fmtMoney(amount);
  return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${meta.unit ? meta.unit + ' ' : ''}${meta.label}`;
}

function DebtListWithRates({ debts, debtPayments, installments, projects, rates, debtFilter, setDebtFilter, showProjectTag, onOpenPayments, onEdit, onDelete }) {
  const [partySearch, setPartySearch] = useState('');
  const search = partySearch.trim().toLowerCase();
  const searchedDebts = search ? debts.filter((d) => (d.party || '').toLowerCase().includes(search)) : debts;

  return (
    <div className="kasa-panel">
      <h2>Borçlar</h2>
      <div className="kasa-filters">
        <button className={debtFilter === 'all' ? 'active' : ''} onClick={() => setDebtFilter('all')}>Hepsi</button>
        <button className={debtFilter === 'odenmemis' ? 'active' : ''} onClick={() => setDebtFilter('odenmemis')}>Ödenmemiş</button>
        <button className={debtFilter === 'alinan' ? 'active' : ''} onClick={() => setDebtFilter('alinan')}>Aldığımız</button>
        <button className={debtFilter === 'verilen' ? 'active' : ''} onClick={() => setDebtFilter('verilen')}>Verdiğimiz</button>
        <button className={debtFilter === 'taksitli' ? 'active' : ''} onClick={() => setDebtFilter('taksitli')}>Taksitli</button>
      </div>
      <input
        className="kasa-input"
        list="debt-party-list"
        placeholder="Kimden/kime ara (yaz veya listeden seç)..."
        value={partySearch}
        onChange={(e) => setPartySearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      <datalist id="debt-party-list">
        {[...new Set(debts.map((d) => d.party).filter(Boolean))].sort().map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div>
        {searchedDebts.length === 0 ? (
          <div className="kasa-empty">{search ? 'Bu aramaya uyan borç yok.' : 'Henüz borç kaydı yok.'}</div>
        ) : (
          searchedDebts.map((d) => {
            const proj = projects.find((pp) => pp.id === d.project_id);
            const meta = currencyMeta(d.currency);
            const isForeign = d.currency && d.currency !== 'TRY';
            const paidAmount = debtPaidAmount(d, debtPayments, installments);
            const remaining = debtRemaining(d, debtPayments, installments);
            const settled = remaining <= 0.0001;
            const debtInstallments = debtInstallmentsFor(d, installments);
            const overdue = debtInstallments.some((i) => !i.paid && i.due_date < todayStr());
            let badgeClass, badgeLabel;
            if (debtInstallments.length > 0) {
              const paidCount = debtInstallments.filter((i) => i.paid).length;
              badgeClass = settled ? 'paid' : overdue ? 'overdue' : paidCount > 0 ? 'partial' : 'unpaid';
              badgeLabel = settled ? 'Ödendi' : `${paidCount}/${debtInstallments.length} Taksit${overdue ? ' · Gecikti' : ''}`;
            } else {
              badgeClass = settled ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
              badgeLabel = settled ? 'Ödendi' : paidAmount > 0 ? `Kalan ${formatCurrencyAmount(remaining, d.currency)}` : 'Ödenmedi';
            }
            return (
              <div className="kasa-debt-row" key={d.id}>
                <div className="kasa-row-date">{fmtDate(d.debt_date)}</div>
                <div>
                  <div className="kasa-row-desc">{d.party}{d.description ? ' · ' + d.description : ''}</div>
                  <div className="kasa-row-cat">
                    {d.type === 'alinan' ? 'Aldığımız Borç' : 'Verdiğimiz Borç'}
                    {showProjectTag && proj ? <> · <span className="kasa-row-proj">{proj.name}</span></> : null}
                    {' · '}<span className="kasa-row-by">{d.added_by}</span>
                  </div>
                </div>
                <div className={`kasa-stamp ${d.type}${isForeign ? ' two-line' : ''}`}>
                  {isForeign ? (
                    <>
                      {new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(d.amount)} {meta.unit ? meta.unit + ' ' : ''}{meta.label}
                      <br />
                      <span style={{ fontSize: 11, fontWeight: 500 }}>≈ {fmtMoney(debtTRYValue({ amount: d.amount, currency: d.currency, rate_snapshot: d.rate_snapshot }, rates))}</span>
                    </>
                  ) : fmtMoney(d.amount)}
                </div>
                <button className={`kasa-paid-badge ${badgeClass}`} onClick={() => onOpenPayments(d.id)}>{badgeLabel}</button>
                <button className="kasa-project-edit" title="Borcu düzenle" onClick={() => onEdit(d)}>✎</button>
                <button className="kasa-del" title="Sil" onClick={() => onDelete(d.id)}>✕</button>
              </div>
            );
          })
        )}
      </div>
      {search && searchedDebts.length > 0 && (() => {
        let alinan = 0, verilen = 0;
        searchedDebts.forEach((d) => {
          const remaining = debtRemaining(d, debtPayments, installments);
          if (remaining <= 0) return;
          const val = debtTRYValue({ amount: remaining, currency: d.currency, rate_snapshot: d.rate_snapshot }, rates);
          if (d.type === 'alinan') alinan += val; else verilen += val;
        });
        return (
          <div className="kasa-search-total">
            <span>Bu aramada ödenmemiş borç <strong>{fmtMoney(alinan)}</strong></span>
            <span>Bu aramada ödenmemiş alacak <strong>{fmtMoney(verilen)}</strong></span>
          </div>
        );
      })()}
    </div>
  );
}

function SettingsModal({ settings, currentUser, onClose, onSave }) {
  const [error, setError] = useState('');
  const isUser1 = currentUser === settings.user1;
  const isUser2 = currentUser === settings.user2;

  const currentPin = isUser1
    ? (settings.pin1 || settings.pin || '1234')
    : (settings.pin2 || settings.pin || '5678');

  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 400 }}>
        <h1>Profil ve Ayarlar</h1>
        <p>Giriş Yapan: <strong>{currentUser || 'Kullanıcı'}</strong></p>
        
        <label className="kasa-field">Şirket / İşletme Adı</label>
        <input className="kasa-input" id="st-company" defaultValue={settings.company_name} />
        
        <label className="kasa-field" style={{ marginTop: 10 }}>Kullanıcı Adınız</label>
        <input
          className="kasa-input"
          id="st-my-name"
          defaultValue={currentUser}
          placeholder="İsminiz"
        />

        <label className="kasa-field" style={{ marginTop: 10 }}>PIN Şifreniz</label>
        <input
          className="kasa-input"
          id="st-my-pin"
          type="password"
          maxLength={4}
          inputMode="numeric"
          defaultValue={currentPin}
          placeholder="••••"
        />

        {error && <div className="kasa-error">{error}</div>}
        
        <button
          className="kasa-save"
          style={{ marginTop: 16 }}
          onClick={() => {
            const company = document.getElementById('st-company').value.trim();
            const myName = document.getElementById('st-my-name').value.trim();
            const myPin = document.getElementById('st-my-pin').value.trim();

            if (!company || !myName || !/^\d{4}$/.test(myPin)) {
              setError('Lütfen tüm alanları doğru doldurun (PIN 4 haneli olmalı).');
              return;
            }

            const updatedSettings = {
              company_name: company,
              user1: isUser1 ? myName : settings.user1,
              user2: isUser2 ? myName : settings.user2,
              pin1: isUser1 ? myPin : (settings.pin1 || settings.pin || '1234'),
              pin2: isUser2 ? myPin : (settings.pin2 || settings.pin || '5678'),
            };

            onSave(updatedSettings);
          }}
        >
          Kaydet
        </button>
        <button className="kasa-link" onClick={onClose}>Kapat</button>
      </div>
    </div>
  );
}

function InstallmentModal({ debt, installments, onTogglePaid, onClose }) {
  if (!debt) return null;
  const sorted = [...installments].sort((a, b) => a.installment_no - b.installment_no);
  const paidCount = sorted.filter((i) => i.paid).length;
  const totalCount = sorted.length;
  const remaining = sorted.filter((i) => !i.paid).reduce((s, i) => s + Number(i.amount), 0);
  const settled = paidCount === totalCount;
  const today = todayStr();

  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 460 }}>
        <h1>Taksitler</h1>
        <p>
          {debt.party}{debt.description ? ' · ' + debt.description : ''} — {debt.type === 'alinan' ? 'Aldığımız Borç' : 'Verdiğimiz Borç'}
        </p>

        <div className="kasa-payment-summary">
          <span>Toplam <strong>{formatCurrencyAmount(Number(debt.amount), debt.currency)}</strong></span>
          <span>Taksit <strong>{paidCount}/{totalCount}</strong></span>
          <span>Kalan <strong style={{ color: settled ? 'var(--income)' : 'var(--expense)' }}>{formatCurrencyAmount(remaining, debt.currency)}</strong></span>
        </div>

        {debt.principal_amount != null && (
          <div className="kasa-payment-summary">
            <span>Ana Para <strong>{formatCurrencyAmount(Number(debt.principal_amount), debt.currency)}</strong></span>
            <span>Faiz <strong style={{ color: 'var(--expense)' }}>{formatCurrencyAmount(Number(debt.amount) - Number(debt.principal_amount), debt.currency)}</strong></span>
          </div>
        )}

        <div className="kasa-payment-list">
          {sorted.map((inst) => {
            const overdue = !inst.paid && inst.due_date < today;
            return (
              <div className="kasa-installment-row" key={inst.id}>
                <span className="kasa-row-date">{fmtDate(inst.due_date)}</span>
                <div>
                  <div className="kasa-row-desc">{inst.installment_no}. Taksit — {formatCurrencyAmount(Number(inst.amount), debt.currency)}</div>
                  {inst.paid ? (
                    <div className="kasa-row-cat">Ödendi: {fmtDate(inst.paid_date)} · <span className="kasa-row-by">{inst.paid_by}</span></div>
                  ) : overdue ? (
                    <div className="kasa-row-cat" style={{ color: 'var(--expense)' }}>Vadesi geçti</div>
                  ) : null}
                </div>
                <button className={`kasa-paid-badge ${inst.paid ? 'paid' : overdue ? 'overdue' : 'unpaid'}`} onClick={() => onTogglePaid(inst.id)}>
                  {inst.paid ? 'Ödendi' : 'Öde'}
                </button>
              </div>
            );
          })}
        </div>

        <button className="kasa-link" onClick={onClose}>Kapat</button>
      </div>
    </div>
  );
}

function PaymentModal({ debt, payments, rates, onAddPayment, onEditPayment, onDeletePayment, onClose }) {
  const [error, setError] = useState('');
  const [editingPayment, setEditingPayment] = useState(null);
  if (!debt) return null;
  const meta = currencyMeta(debt.currency);
  const paidAmount = debtPaidAmount(debt, payments);
  const remaining = debtRemaining(debt, payments);
  const settled = remaining <= 0.0001;
  const isForeign = debt.currency && debt.currency !== 'TRY';
  const remainingTRYFrozen = isForeign ? debtTRYValue({ amount: remaining, currency: debt.currency, rate_snapshot: debt.rate_snapshot }, rates) : null;
  const remainingTRYLive = isForeign ? debtTRYValueLive({ amount: remaining, currency: debt.currency }, rates) : null;
  const sortedPayments = [...payments].sort(
    (a, b) => b.payment_date.localeCompare(a.payment_date) || new Date(b.created_at) - new Date(a.created_at)
  );

  function submit(amount) {
    if (!amount || amount <= 0) { setError('Geçerli bir tutar girin.'); return; }
    if (amount > remaining + 0.0001) {
      setError(`Kalan tutardan (${formatCurrencyAmount(remaining, debt.currency)}) fazla ödeme giremezsiniz.`);
      return;
    }
    setError('');
    const date = document.getElementById('pm-date')?.value || todayStr();
    const desc = document.getElementById('pm-desc')?.value.trim() || '';
    onAddPayment(amount, date, desc);
    const amountInput = document.getElementById('pm-amount');
    const descInput = document.getElementById('pm-desc');
    if (amountInput) amountInput.value = '';
    if (descInput) descInput.value = '';
  }

  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 440 }}>
        <h1>Ödemeler</h1>
        <p>
          {debt.party}{debt.description ? ' · ' + debt.description : ''} — {debt.type === 'alinan' ? 'Aldığımız Borç' : 'Verdiğimiz Borç'}
        </p>

        <div className="kasa-payment-summary">
          <span>Toplam <strong>{formatCurrencyAmount(Number(debt.amount), debt.currency)}</strong></span>
          <span>Ödenen <strong>{formatCurrencyAmount(paidAmount, debt.currency)}</strong></span>
          <span>Kalan <strong style={{ color: settled ? 'var(--income)' : 'var(--expense)' }}>{formatCurrencyAmount(remaining, debt.currency)}</strong></span>
        </div>

        {isForeign && !settled && (
          <div className="kasa-search-total">
            <span>Kalanın ₺ karşılığı ({debt.rate_snapshot ? 'alındığı kur' : 'güncel kur'}) <strong>{fmtMoney(remainingTRYFrozen)}</strong></span>
            {debt.rate_snapshot && (
              <span>Bugünkü kurla <strong>{fmtMoney(remainingTRYLive)}</strong> ({remainingTRYLive >= remainingTRYFrozen ? '+' : ''}{fmtMoney(remainingTRYLive - remainingTRYFrozen)})</span>
            )}
          </div>
        )}

        {payments.length === 0 && debt.paid && (
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
            Bu borç, ödeme geçmişi eklenmeden önce elle &quot;Ödendi&quot; olarak işaretlenmiş.
          </p>
        )}

        <div className="kasa-payment-list">
          {sortedPayments.length === 0 ? (
            <div className="kasa-empty">Henüz ödeme kaydı yok.</div>
          ) : (
            sortedPayments.map((p) => (
              <div className="kasa-payment-row" key={p.id}>
                <span className="kasa-row-date">{fmtDate(p.payment_date)}</span>
                <div>
                  <div className="kasa-row-desc">{formatCurrencyAmount(Number(p.amount), debt.currency)}</div>
                  <div className="kasa-row-cat">
                    {p.description ? <>{p.description} · </> : null}
                    <span className="kasa-row-by">{p.added_by}</span>
                  </div>
                </div>
                <button className="kasa-project-edit" title="Ödemeyi düzenle" onClick={() => setEditingPayment(p)}>✎</button>
                <button className="kasa-del" title="Sil" onClick={() => onDeletePayment(p.id)}>✕</button>
              </div>
            ))
          )}
        </div>

        {editingPayment && (
          <EditPaymentModal
            payment={editingPayment}
            currency={debt.currency}
            maxAmount={remaining + Number(editingPayment.amount)}
            onClose={() => setEditingPayment(null)}
            onSave={async (entry) => {
              const ok = await onEditPayment(editingPayment.id, entry);
              if (ok) setEditingPayment(null);
              return ok;
            }}
          />
        )}

        {!settled && (
          <>
            <label className="kasa-field">Ödeme Tutarı{meta.unit ? ` (${meta.unit})` : ''}</label>
            <input className="kasa-input" id="pm-amount" type="number" min="0" step="0.01" placeholder="0.00" />
            <label className="kasa-field">Açıklama</label>
            <input className="kasa-input" id="pm-desc" placeholder="Örn. Nakit elden ödeme" autoComplete="off" />
            <label className="kasa-field">Tarih</label>
            <input className="kasa-input" id="pm-date" type="date" defaultValue={todayStr()} />
            {error && <div className="kasa-error">{error}</div>}
            <button
              className="kasa-save"
              style={{ marginTop: 12 }}
              onClick={() => submit(parseFloat(document.getElementById('pm-amount').value))}
            >
              Ödeme Ekle
            </button>
            <button className="kasa-link" onClick={() => submit(remaining)}>
              Kalanın Tamamını Öde ({formatCurrencyAmount(remaining, debt.currency)})
            </button>
          </>
        )}

        <button className="kasa-link" onClick={onClose}>Kapat</button>
      </div>
    </div>
  );
}

function EditPaymentModal({ payment, currency, maxAmount, onClose, onSave }) {
  const [error, setError] = useState('');
  const meta = currencyMeta(currency);
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 380 }}>
        <h1>Ödemeyi Düzenle</h1>
        <label className="kasa-field">Ödeme Tutarı{meta.unit ? ` (${meta.unit})` : ''}</label>
        <input className="kasa-input" id="epm-amount" type="number" min="0" step="0.01" defaultValue={payment.amount} />
        <label className="kasa-field">Açıklama</label>
        <input className="kasa-input" id="epm-desc" defaultValue={payment.description || ''} autoComplete="off" />
        <label className="kasa-field">Tarih</label>
        <input className="kasa-input" id="epm-date" type="date" defaultValue={payment.payment_date} />
        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          onClick={async () => {
            const amount = parseFloat(document.getElementById('epm-amount').value);
            const desc = document.getElementById('epm-desc').value.trim();
            const date = document.getElementById('epm-date').value || payment.payment_date;
            if (!amount || amount <= 0) { setError('Geçerli bir tutar girin.'); return; }
            if (amount > maxAmount + 0.0001) {
              setError(`Tutar, borcun toplamını aşamaz (en fazla ${formatCurrencyAmount(maxAmount, currency)}).`);
              return;
            }
            setError('');
            const ok = await onSave({ amount, desc, date });
            if (!ok) setError('Kaydedilemedi, tekrar deneyin.');
          }}
        >
          Kaydet
        </button>
        <button className="kasa-link" onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

function AddBankModal({ onClose, onCreate }) {
  const [error, setError] = useState('');
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 380 }}>
        <h1>Yeni Banka</h1>
        <p>Gider kayıtlarında seçilebilecek banka listesine eklenecek.</p>
        <label className="kasa-field">Banka adı</label>
        <input className="kasa-input" id="ab-name" placeholder="Örn. Ziraat Bankası" />
        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          onClick={() => {
            const name = document.getElementById('ab-name').value.trim();
            if (!name) { setError('Banka adı girin.'); return; }
            onCreate(name);
          }}
        >
          Ekle
        </button>
        <button className="kasa-link" onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

function NewProjectModal({ onClose, onCreate }) {
  const [error, setError] = useState('');
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 380 }}>
        <h1>Yeni Proje</h1>
        <p>Bu proje kendi ayrı kasa hesabına sahip olacak.</p>
        <label className="kasa-field">Proje adı</label>
        <input className="kasa-input" id="np-name" placeholder="Örn. İnşaat İşi, Şube 2" />
        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          onClick={async () => {
            const name = document.getElementById('np-name').value.trim();
            if (!name) { setError('Proje adı girin.'); return; }
            const result = await onCreate(name);
            if (result && !result.success) setError(result.error || 'Kaydedilemedi.');
          }}
        >
          Oluştur
        </button>
        <button className="kasa-link" onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

function EditProjectModal({ project, onClose, onSave }) {
  const [error, setError] = useState('');
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 380 }}>
        <h1>Proje Adını Düzenle</h1>
        <label className="kasa-field">Proje adı</label>
        <input className="kasa-input" id="ep-name" defaultValue={project.name} placeholder="Örn. İnşaat İşi, Şube 2" />
        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          onClick={async () => {
            const name = document.getElementById('ep-name').value.trim();
            if (!name) { setError('Proje adı girin.'); return; }
            const result = await onSave(name);
            if (result && !result.success) setError(result.error || 'Kaydedilemedi.');
          }}
        >
          Kaydet
        </button>
        <button className="kasa-link" onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

function EditDebtModal({ debt, onClose, onSave }) {
  const [error, setError] = useState('');
  const [type, setType] = useState(debt.type);
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 420 }}>
        <h1>Borcu Düzenle</h1>
        <div className="kasa-toggle">
          <button className={`alinan ${type === 'alinan' ? 'active alinan' : ''}`} onClick={() => setType('alinan')}>Aldığımız Borç</button>
          <button className={`verilen ${type === 'verilen' ? 'active verilen' : ''}`} onClick={() => setType('verilen')}>Verdiğimiz Borç</button>
        </div>
        <label className="kasa-field">Para Birimi</label>
        <select className="kasa-select" id="ed-currency" defaultValue={debt.currency}>
          {Object.entries(CURRENCIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="kasa-field">Tutar</label>
        <input className="kasa-input" id="ed-amount" type="number" min="0" step="0.01" defaultValue={debt.amount} />
        <label className="kasa-field">{type === 'alinan' ? 'Kimden alındı' : 'Kime verildi'}</label>
        <input className="kasa-input" id="ed-party" defaultValue={debt.party || ''} placeholder="Örn. Ahmet Usta / Banka" />
        <label className="kasa-field">Açıklama</label>
        <input className="kasa-input" id="ed-desc" defaultValue={debt.description || ''} placeholder="Örn. Malzeme avansı" />
        <label className="kasa-field">Tarih</label>
        <input className="kasa-input" id="ed-date" type="date" defaultValue={debt.debt_date} />
        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          onClick={async () => {
            const amount = parseFloat(document.getElementById('ed-amount').value);
            const currency = document.getElementById('ed-currency').value;
            const party = document.getElementById('ed-party').value.trim();
            const desc = document.getElementById('ed-desc').value.trim();
            const date = document.getElementById('ed-date').value || debt.debt_date;
            if (!amount || amount <= 0) { setError('Geçerli bir tutar girin.'); return; }
            if (!party) { setError('Kimden/kime bilgisini girin.'); return; }
            setError('');
            const ok = await onSave({ type, amount, currency, party, desc, date });
            if (!ok) setError('Kaydedilemedi, tekrar deneyin.');
          }}
        >
          Kaydet
        </button>
        <button className="kasa-link" onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

function EditTxnModal({ txn, banks, onClose, onSave }) {
  const [error, setError] = useState('');
  const [type, setType] = useState(txn.type);
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 420 }}>
        <h1>Hareketi Düzenle</h1>
        <div className="kasa-toggle">
          <button className={`gelir ${type === 'gelir' ? 'active gelir' : ''}`} onClick={() => setType('gelir')}>+ Gelir</button>
          <button className={`gider ${type === 'gider' ? 'active gider' : ''}`} onClick={() => setType('gider')}>− Gider</button>
        </div>
        <label className="kasa-field">Tutar (₺)</label>
        <input className="kasa-input" id="et-amount" type="number" min="0" step="0.01" defaultValue={txn.amount} />
        {type === 'gider' ? (
          <>
            <label className="kasa-field">Kime</label>
            <input className="kasa-input" id="et-party" defaultValue={txn.party || ''} placeholder="Örn. Ahmet Usta / Belediye" />
            <label className="kasa-field">Banka</label>
            <select className="kasa-select" id="et-bank" defaultValue={txn.bank || (banks.find((b) => b.name === 'Nakit') ? 'Nakit' : '')}>
              {banks.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </>
        ) : (
          <>
            <label className="kasa-field">Kategori</label>
            <select className="kasa-select" id="et-cat" defaultValue={txn.category || CATS_GELIR[0]}>
              {CATS_GELIR.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
        <label className="kasa-field">Açıklama</label>
        <input className="kasa-input" id="et-desc" defaultValue={txn.description || ''} placeholder="Örn. Ocak ayı kira" />
        <label className="kasa-field">Tarih</label>
        <input className="kasa-input" id="et-date" type="date" defaultValue={txn.txn_date} />
        {error && <div className="kasa-error">{error}</div>}
        <button
          className="kasa-save"
          onClick={async () => {
            const amount = parseFloat(document.getElementById('et-amount').value);
            const desc = document.getElementById('et-desc').value.trim();
            const date = document.getElementById('et-date').value || txn.txn_date;
            if (!amount || amount <= 0) { setError('Geçerli bir tutar girin.'); return; }
            let category = null, party = null, bank = null;
            if (type === 'gider') {
              party = document.getElementById('et-party').value.trim();
              bank = document.getElementById('et-bank').value;
              if (!party) { setError('Kime ödendiğini girin.'); return; }
            } else {
              category = document.getElementById('et-cat').value;
            }
            setError('');
            const ok = await onSave({ type, amount, category, party, bank, desc, date });
            if (!ok) setError('Kaydedilemedi, tekrar deneyin.');
          }}
        >
          Kaydet
        </button>
        <button className="kasa-link" onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

function ConfirmModal({ message, onYes, onNo }) {
  return (
    <div className="kasa-modal-overlay">
      <div className="kasa-auth-card" style={{ maxWidth: 380 }}>
        <h1>Emin misiniz?</h1>
        <p>{message}</p>
        <button className="kasa-save" style={{ background: 'var(--expense)' }} onClick={onYes}>Evet, Sil</button>
        <button className="kasa-link" onClick={onNo}>Vazgeç</button>
      </div>
    </div>
  );
}
