import { ConnectButton, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useState } from 'react';

const PACKAGE_ID = '0xc1222e16659a5be11e3488c2359cce641a4c536e2569d707a22444a57b56c2a7';
const CLOCK_ID = '0x6';
const WALRUS_PUBLISHER = 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

const PRIVATE_FEES = [150000000,190000000,210000000,230000000,250000000,265000000,275000000,295000000,315000000,335000000,420000000,505000000,580000000,665000000,750000000,835000000,920000000,995000000,1060000000,1145000000];
const COMMERCIAL_FEES = [225000000,285000000,315000000,345000000,375000000,397500000,412500000,442500000,472500000,502500000,630000000,757500000,870000000,997500000,1125000000,1252500000,1380000000,1492500000,1590000000,1717500000];
const TIERS = [[690,'0-690m²'],[1160,'691-1,160m²'],[1620,'1,161-1,620m²'],[2090,'1,621-2,090m²'],[2550,'2,091-2,550m²'],[3020,'2,551-3,020m²'],[3480,'3,021-3,480m²'],[3950,'3,481-3,950m²'],[4410,'3,951-4,410m²'],[4880,'4,411-4,880m²'],[7200,'4,881-7,200m²'],[10000,'7,200m²-1Ha'],[20000,'1-2Ha'],[50000,'2-5Ha'],[100000,'5-10Ha'],[150000,'10-15Ha'],[200000,'15-20Ha'],[300000,'20-30Ha'],[400000,'30-40Ha'],[500000,'40-50Ha']];

function getFeeIndex(area) {
  for (let i = 0; i < TIERS.length; i++) {
    if (area <= TIERS[i][0]) return i;
  }
  return TIERS.length - 1;
}

function fmt(n) { return '₦' + Math.round(n).toLocaleString(); }

export default function App() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();

  const [tab, setTab] = useState('calculator');
  const [area, setArea] = useState(500);
  const [landType, setLandType] = useState(0);
  const [jobId, setJobId] = useState('JOB-KW-2026-001');
  const [description, setDescription] = useState('Cadastral Survey - Private Land, Ilorin');
  const [surveyorAddr, setSurveyorAddr] = useState('');
  const [surconAddr, setSurconAddr] = useState('');
  const [coinId, setCoinId] = useState('');
  const [escrowId, setEscrowId] = useState('');
  const [docHash, setDocHash] = useState('');
  const [docName, setDocName] = useState('');
  const [docFormat, setDocFormat] = useState('DWG');
  const [docUrl, setDocUrl] = useState('');
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState('info');
  const [coins, setCoins] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  const idx = getFeeIndex(area);
  const fee = landType === 0 ? PRIVATE_FEES[idx] : COMMERCIAL_FEES[idx];
  const surveyor30 = Math.round(fee * 0.3);
  const surcon70 = Math.round(fee * 0.7);

  const showStatus = (msg, type = 'info') => { setStatus(msg); setStatusType(type); };

  // ===== LOAD COINS =====
  const loadCoins = async () => {
    if (!account) return showStatus('Please connect your wallet first!', 'error');
    const res = await client.getCoins({ owner: account.address, coinType: '0x2::sui::SUI' });
    setCoins(res.data);
    if (res.data.length > 0) setCoinId(res.data[0].coinObjectId);
    showStatus(`Found ${res.data.length} coin objects`, 'success');
  };

  // ===== WALRUS FILE UPLOAD =====
  const uploadToWalrus = async (file) => {
    setUploading(true);
    setUploadProgress('Reading file...');
    try {
      const fileBytes = await file.arrayBuffer();
      setUploadProgress('Uploading to Walrus decentralized storage...');

      const response = await fetch(
        `${WALRUS_PUBLISHER}/v1/blobs?epochs=10`,
        {
          method: 'PUT',
          body: fileBytes,
          headers: { 'Content-Type': 'application/octet-stream' },
        }
      );

      if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);

      const result = await response.json();
      const blobId = result.newlyCreated?.blobObject?.blobId ||
                     result.alreadyCertified?.blobId ||
                     result.blobId;

      if (!blobId) throw new Error('No blob ID returned from Walrus');

      const storageUrl = `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`;

      setDocHash(blobId);
      setDocUrl(storageUrl);
      setUploadProgress('');
      setUploading(false);

      showStatus(`✅ Document uploaded to Walrus! Blob ID: ${blobId.slice(0,20)}...`, 'success');
      return { blobId, storageUrl };

    } catch (e) {
      setUploading(false);
      setUploadProgress('');
      showStatus(`❌ Walrus upload failed: ${e.message}`, 'error');
      return null;
    }
  };

  // ===== HANDLE FILE SELECTION =====
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!account) {
      showStatus('Please connect your wallet before uploading!', 'error');
      return;
    }

    setDocName(file.name);
    const ext = file.name.split('.').pop().toUpperCase();
    setDocFormat(ext);

    showStatus(`Selected: ${file.name} (${Math.round(file.size / 1024)} KB) — uploading to Walrus...`, 'info');
    await uploadToWalrus(file);
  };

  // ===== CREATE ESCROW V2 =====
  const createEscrowV2 = async () => {
    if (!account) return showStatus('Please connect your wallet first!', 'error');
    if (!surveyorAddr || !surconAddr || !coinId) return showStatus('Please fill all fields!', 'error');
    showStatus('Building transaction...', 'info');
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::geopay_escrow::create_escrow_v2`,
        arguments: [
          tx.object(coinId),
          tx.pure.address(surveyorAddr),
          tx.pure.address(surconAddr),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(jobId))),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(description))),
          tx.pure.u64(area),
          tx.pure.u8(landType),
          tx.object(CLOCK_ID),
        ],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (result) => showStatus(`✅ Escrow created with 7-day lock! Digest: ${result.digest}`, 'success'),
        onError: (err) => showStatus(`❌ Error: ${err.message}`, 'error'),
      });
    } catch (e) { showStatus(`❌ ${e.message}`, 'error'); }
  };

  // ===== SUBMIT RED COPY V2 (with Walrus blob ID) =====
  const submitRedCopyV2 = async () => {
    if (!account) return showStatus('Please connect your wallet first!', 'error');
    if (!escrowId) return showStatus('Please enter escrow ID!', 'error');
    if (!docHash) return showStatus('Please upload a document first!', 'error');
    showStatus('Submitting document on-chain...', 'info');
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::geopay_escrow::submit_red_copy_v2`,
        arguments: [
          tx.object(escrowId),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(docHash))),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(docName))),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(docFormat))),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(docUrl))),
          tx.object(CLOCK_ID),
        ],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (result) => showStatus(`✅ Document submitted! SURCON notified. Digest: ${result.digest}`, 'success'),
        onError: (err) => showStatus(`❌ Error: ${err.message}`, 'error'),
      });
    } catch (e) { showStatus(`❌ ${e.message}`, 'error'); }
  };

  // ===== CONFIRM RELEASE =====
  const confirmRelease = async () => {
    if (!account) return showStatus('Please connect wallet!', 'error');
    if (!escrowId) return showStatus('Please enter escrow ID!', 'error');
    showStatus('Processing 70/30 payment split...', 'info');
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::geopay_escrow::confirm_and_release`,
        arguments: [tx.object(escrowId)],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (result) => showStatus(`✅ Payment released! 30% to Surveyor, 70% to SURCON/NIS. Digest: ${result.digest}`, 'success'),
        onError: (err) => showStatus(`❌ Error: ${err.message}`, 'error'),
      });
    } catch (e) { showStatus(`❌ ${e.message}`, 'error'); }
  };

  // ===== CLAIM EXPIRED =====
  const claimExpired = async () => {
    if (!account) return showStatus('Please connect wallet!', 'error');
    if (!escrowId) return showStatus('Please enter escrow ID!', 'error');
    showStatus('Claiming expired refund...', 'info');
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::geopay_escrow::claim_expired_refund`,
        arguments: [tx.object(escrowId), tx.object(CLOCK_ID)],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (result) => showStatus(`✅ Refund claimed! Full payment returned. Digest: ${result.digest}`, 'success'),
        onError: (err) => showStatus(`❌ Error: ${err.message}`, 'error'),
      });
    } catch (e) { showStatus(`❌ ${e.message}`, 'error'); }
  };

  // ===== STYLES =====
  const s = {
    app: { fontFamily: 'DM Sans, sans-serif', background: '#f8f9f7', minHeight: '100vh' },
    header: { background: '#0F6E56', color: '#fff', padding: '0 2rem', height: 60, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 12px rgba(0,0,0,0.15)' },
    logo: { fontFamily: 'monospace', fontSize: 18, fontWeight: 700 },
    container: { maxWidth: 860, margin: '0 auto', padding: '1.5rem' },
    hero: { background: 'linear-gradient(135deg, #0F6E56, #1a3c5e)', color: '#fff', padding: '2.5rem 2rem', textAlign: 'center' },
    heroTag: { display: 'inline-block', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 20, padding: '4px 14px', fontSize: 11, fontFamily: 'monospace', marginBottom: 12, letterSpacing: 1 },
    heroH1: { fontSize: '1.8rem', fontWeight: 600, marginBottom: 8 },
    heroP: { fontSize: 13, opacity: 0.8, maxWidth: 520, margin: '0 auto' },
    tabs: { display: 'flex', background: '#fff', border: '1px solid #e0e5e2', borderRadius: 12, overflow: 'hidden', marginBottom: 16, marginTop: 20 },
    tab: { flex: 1, padding: '11px 6px', border: 'none', background: 'none', fontSize: 12, fontWeight: 500, color: '#6b7570', cursor: 'pointer', borderRight: '1px solid #e0e5e2' },
    tabActive: { flex: 1, padding: '11px 6px', border: 'none', background: '#1D9E75', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', borderRight: '1px solid #e0e5e2' },
    card: { background: '#fff', border: '1px solid #e0e5e2', borderRadius: 12, padding: '1.25rem 1.5rem', marginBottom: 12 },
    cardTitle: { fontSize: 11, fontWeight: 600, color: '#6b7570', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid #e0e5e2' },
    label: { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7570', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { width: '100%', padding: '9px 12px', border: '1px solid #e0e5e2', borderRadius: 8, fontSize: 13, outline: 'none', background: '#f8f9f7', marginBottom: 12, boxSizing: 'border-box' },
    select: { width: '100%', padding: '9px 12px', border: '1px solid #e0e5e2', borderRadius: 8, fontSize: 13, outline: 'none', background: '#f8f9f7', marginBottom: 12, boxSizing: 'border-box' },
    row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    btnPrimary: { width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: '#1D9E75', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginTop: 8 },
    btnDanger: { width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: '#fee2e2', color: '#dc2626', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginTop: 8 },
    btnSecondary: { width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: '#E6F1FB', color: '#1a3c5e', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginTop: 8 },
    metrics: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 },
    metric: { background: '#f8f9f7', border: '1px solid #e0e5e2', borderRadius: 10, padding: '1rem', textAlign: 'center' },
    metricLabel: { fontSize: 10, color: '#6b7570', textTransform: 'uppercase', marginBottom: 5 },
    metricValue: { fontSize: '1.3rem', fontWeight: 600, fontFamily: 'monospace' },
    splitBoxes: { display: 'grid', gridTemplateColumns: '3fr 7fr', gap: 8, marginTop: 10 },
    splitS: { background: '#E1F5EE', borderRadius: 10, padding: 10, textAlign: 'center' },
    splitR: { background: '#E6F1FB', borderRadius: 10, padding: 10, textAlign: 'center' },
    splitLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
    splitValue: { fontSize: 16, fontWeight: 600, fontFamily: 'monospace' },
    alert: (type) => ({ padding: '10px 14px', borderRadius: 8, fontSize: 12, marginTop: 10, lineHeight: 1.5, background: type==='success'?'#E1F5EE':type==='error'?'#fee2e2':type==='warning'?'#FFF8E7':'#E6F1FB', color: type==='success'?'#085041':type==='error'?'#dc2626':type==='warning'?'#c8961e':'#0C447C', border: `1px solid ${type==='success'?'#9FE1CB':type==='error'?'#fca5a5':type==='warning'?'#FAC775':'#B5D4F4'}` }),
    tierBadge: { display: 'inline-block', background: '#FFF8E7', color: '#c8961e', border: '1px solid #f0d080', borderRadius: 20, padding: '4px 12px', fontSize: 11, fontFamily: 'monospace', marginTop: 8 },
    uploadArea: (hasFile) => ({ border: `2px dashed ${hasFile ? '#1D9E75' : '#e0e5e2'}`, borderRadius: 10, padding: '1.5rem', textAlign: 'center', cursor: 'pointer', background: hasFile ? '#E1F5EE' : '#f8f9f7', marginBottom: 12, transition: 'all 0.2s' }),
    walrusBadge: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1a3c5e', color: '#9FE1CB', borderRadius: 20, padding: '4px 12px', fontSize: 11, fontFamily: 'monospace', marginTop: 8 },
    footer: { textAlign: 'center', padding: '2rem', fontSize: 11, color: '#6b7570', borderTop: '1px solid #e0e5e2', marginTop: '2rem', fontFamily: 'monospace', lineHeight: 1.8 },
  };

  return (
    <div style={s.app}>
      {/* HEADER */}
      <header style={s.header}>
        <div style={s.logo}>📍 GeoPay</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {account && (
            <div style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, padding: '4px 12px', fontSize: 11, fontFamily: 'monospace' }}>
              🟢 {account.address.slice(0,8)}...{account.address.slice(-4)}
            </div>
          )}
          <ConnectButton />
        </div>
      </header>

      {/* HERO */}
      <div style={s.hero}>
        <div style={s.heroTag}>SUI OVERFLOW 2026 · NIGERIA 🇳🇬 · DEFI & PAYMENTS</div>
        <h1 style={s.heroH1}>GeoPay — Decentralized Spatial Regulatory Protocol</h1>
        <p style={s.heroP}>Kwara State fee schedule · Automated escrow · 7-day time lock · Walrus document storage · 70/30 SURCON settlement</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '1rem' }}>
          {['20 Fee Tiers', '70/30 Auto Split', '7-Day Lock', 'Walrus Storage'].map(f => (
            <div key={f} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>✅</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{f}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={s.container}>
        {!account && (
          <div style={{ ...s.alert('warning'), marginBottom: 16, fontSize: 13, textAlign: 'center' }}>
            👛 Please connect your Sui Wallet to use GeoPay
          </div>
        )}

        {/* TABS */}
        <div style={s.tabs}>
          {['calculator','escrow','document','release'].map((t, i) => (
            <button key={t} style={tab===t ? s.tabActive : s.tab} onClick={() => setTab(t)}>
              {['🧮 Calculator', '🔒 Create Escrow', '📁 Upload Doc', '💰 Release'][i]}
            </button>
          ))}
        </div>

        {/* STATUS */}
        {status && <div style={s.alert(statusType)}>{status}</div>}

        {/* ===== CALCULATOR ===== */}
        {tab === 'calculator' && (
          <>
            <div style={s.card}>
              <div style={s.cardTitle}>Land details — Kwara State, Nigeria</div>
              <div style={s.row}>
                <div>
                  <label style={s.label}>Land area (m²)</label>
                  <input style={s.input} type="number" value={area} min="1" onChange={e => setArea(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label style={s.label}>Land type</label>
                  <select style={s.select} value={landType} onChange={e => setLandType(parseInt(e.target.value))}>
                    <option value={0}>Private land</option>
                    <option value={1}>Commercial land</option>
                  </select>
                </div>
              </div>
              <div style={s.tierBadge}>⚡ Tier {idx + 1} — {TIERS[idx][1]}</div>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>Official Kwara State fee (SURCON Approved)</div>
              <div style={s.metrics}>
                <div style={s.metric}><div style={s.metricLabel}>Survey fee</div><div style={{ ...s.metricValue, color: '#0F6E56' }}>{fmt(fee)}</div></div>
                <div style={s.metric}><div style={s.metricLabel}>Mandatory 70%</div><div style={{ ...s.metricValue, color: '#1a3c5e' }}>{fmt(surcon70)}</div></div>
                <div style={s.metric}><div style={s.metricLabel}>Surveyor earns</div><div style={{ ...s.metricValue, color: '#c8961e' }}>{fmt(surveyor30)}</div></div>
              </div>
              <div style={s.splitBoxes}>
                <div style={s.splitS}><div style={{ ...s.splitLabel, color: '#085041' }}>Surveyor (30%)</div><div style={{ ...s.splitValue, color: '#085041' }}>{fmt(surveyor30)}</div></div>
                <div style={s.splitR}><div style={{ ...s.splitLabel, color: '#0C447C' }}>SURCON/NIS (70%)</div><div style={{ ...s.splitValue, color: '#0C447C' }}>{fmt(surcon70)}</div></div>
              </div>
              <button style={s.btnPrimary} onClick={() => setTab('escrow')}>🔒 Create escrow with this fee →</button>
            </div>
          </>
        )}

        {/* ===== CREATE ESCROW ===== */}
        {tab === 'escrow' && (
          <>
            <div style={s.card}>
              <div style={s.cardTitle}>Job information</div>
              <div style={s.row}>
                <div><label style={s.label}>Job ID</label><input style={s.input} value={jobId} onChange={e => setJobId(e.target.value)} /></div>
                <div><label style={s.label}>Land area (m²)</label><input style={s.input} type="number" value={area} onChange={e => setArea(parseFloat(e.target.value) || 0)} /></div>
              </div>
              <label style={s.label}>Description</label>
              <input style={s.input} value={description} onChange={e => setDescription(e.target.value)} />
              <label style={s.label}>Land type</label>
              <select style={s.select} value={landType} onChange={e => setLandType(parseInt(e.target.value))}>
                <option value={0}>Private (0)</option>
                <option value={1}>Commercial (1)</option>
              </select>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>Parties & payment</div>
              <label style={s.label}>Your address (client)</label>
              <input style={{ ...s.input, color: '#6b7570' }} value={account?.address || 'Connect wallet first'} readOnly />
              <label style={s.label}>Surveyor wallet address</label>
              <input style={s.input} placeholder="0xSurveyor..." value={surveyorAddr} onChange={e => setSurveyorAddr(e.target.value)} />
              <label style={s.label}>Regulatory body address (SURCON/NIS)</label>
              <input style={s.input} placeholder="0xSURCON..." value={surconAddr} onChange={e => setSurconAddr(e.target.value)} />
              <label style={s.label}>Payment coin object ID</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...s.input, marginBottom: 0, flex: 1 }} placeholder="0xe146..." value={coinId} onChange={e => setCoinId(e.target.value)} />
                <button style={{ ...s.btnPrimary, width: 'auto', marginTop: 0, padding: '9px 14px', fontSize: 12 }} onClick={loadCoins}>Load coins</button>
              </div>
              {coins.length > 0 && (
                <select style={{ ...s.select, marginTop: 8 }} onChange={e => setCoinId(e.target.value)}>
                  {coins.map(c => <option key={c.coinObjectId} value={c.coinObjectId}>{c.coinObjectId.slice(0, 20)}... ({(parseInt(c.balance) / 1e9).toFixed(3)} SUI)</option>)}
                </select>
              )}
              <div style={{ ...s.alert('info'), marginTop: 8 }}>⏰ Creates escrow with 7-day time lock — surveyor must submit document within 7 days or client can claim full refund.</div>
              <button style={s.btnPrimary} onClick={createEscrowV2}>⏰ Create escrow with 7-day time lock</button>
            </div>
          </>
        )}

        {/* ===== DOCUMENT UPLOAD ===== */}
        {tab === 'document' && (
          <>
            <div style={s.card}>
              <div style={s.cardTitle}>Upload digital red copy to Walrus</div>

              <div style={s.alert('info')}>
                🦭 Documents are stored permanently on <strong>Walrus</strong> — Sui's decentralized storage. Supports DWG, DXF, PDF, AutoCAD, PNG, JPG and any format. The Blob ID is automatically stored in your smart contract.
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={s.label}>Escrow object ID</label>
                <input style={s.input} placeholder="0xe20b5a37..." value={escrowId} onChange={e => setEscrowId(e.target.value)} />
              </div>

              {/* FILE UPLOAD AREA */}
              <div
                style={s.uploadArea(!!docHash)}
                onClick={() => document.getElementById('file-input').click()}
              >
                {uploading ? (
                  <>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏳</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1D9E75' }}>{uploadProgress}</div>
                  </>
                ) : docHash ? (
                  <>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#085041' }}>{docName}</div>
                    <div style={{ fontSize: 11, color: '#6b7570', marginTop: 4 }}>Stored on Walrus · {docFormat}</div>
                    <div style={s.walrusBadge}>🦭 Blob ID: {docHash.slice(0, 20)}...</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>📁</div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Click to upload survey document</div>
                    <div style={{ fontSize: 11, color: '#6b7570' }}>DWG · DXF · PDF · AutoCAD · PNG · JPG · Any format</div>
                    <div style={{ fontSize: 11, color: '#1D9E75', marginTop: 4 }}>→ Automatically stored on Walrus decentralized storage</div>
                  </>
                )}
                <input
                  type="file"
                  id="file-input"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                  accept=".dwg,.dxf,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.shp,.kml,.autocad"
                />
              </div>

              {docHash && (
                <>
                  <div style={s.row}>
                    <div><label style={s.label}>File name</label><input style={s.input} value={docName} onChange={e => setDocName(e.target.value)} /></div>
                    <div>
                      <label style={s.label}>File format</label>
                      <select style={s.select} value={docFormat} onChange={e => setDocFormat(e.target.value)}>
                        {['DWG', 'DXF', 'PDF', 'AutoCAD', 'PNG', 'JPG', 'TIF', 'SHP', 'KML', 'Other'].map(f => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                  <label style={s.label}>Walrus Blob ID (auto-filled)</label>
                  <input style={{ ...s.input, color: '#085041', background: '#E1F5EE' }} value={docHash} readOnly />
                  <label style={s.label}>Storage URL (auto-filled)</label>
                  <input style={{ ...s.input, color: '#085041', background: '#E1F5EE' }} value={docUrl} readOnly />
                </>
              )}

              <button
                style={{ ...s.btnPrimary, opacity: (!docHash || uploading) ? 0.6 : 1 }}
                onClick={submitRedCopyV2}
                disabled={!docHash || uploading}
              >
                📁 Submit document on-chain (notify SURCON/NIS)
              </button>
            </div>
          </>
        )}

        {/* ===== RELEASE PAYMENT ===== */}
        {tab === 'release' && (
          <>
            <div style={s.card}>
              <div style={s.cardTitle}>Escrow object ID</div>
              <input style={s.input} placeholder="0xe20b5a37..." value={escrowId} onChange={e => setEscrowId(e.target.value)} />
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>✅ Confirm & release payment (70/30)</div>
              <div style={s.splitBoxes}>
                <div style={s.splitS}><div style={{ ...s.splitLabel, color: '#085041' }}>Surveyor (30%)</div><div style={{ ...s.splitValue, color: '#085041' }}>{fmt(surveyor30)}</div></div>
                <div style={s.splitR}><div style={{ ...s.splitLabel, color: '#0C447C' }}>SURCON/NIS (70%)</div><div style={{ ...s.splitValue, color: '#0C447C' }}>{fmt(surcon70)}</div></div>
              </div>
              <button style={s.btnPrimary} onClick={confirmRelease}>✅ Confirm & release payment</button>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>⏰ Claim expired refund (after 7 days)</div>
              <div style={{ ...s.alert('warning'), marginBottom: 8 }}>Only available if surveyor missed the 7-day deadline.</div>
              <button style={s.btnDanger} onClick={claimExpired}>⏰ Claim expired refund</button>
            </div>
          </>
        )}
      </div>

      <footer style={s.footer}>
        GeoPay · Sui Overflow 2026 · DeFi & Payments · Powered by Walrus 🦭<br />
        Ahmed Omokunmi Muhammed · Professional Surveyor · Nigeria 🇳🇬<br />
        Package: 0xc1222e16659a5be11e3488c2359cce641a4c536e2569d707a22444a57b56c2a7
      </footer>
    </div>
  );
}