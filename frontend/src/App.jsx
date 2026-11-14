import React, { useState, useEffect } from "react";
import "./App.css";

const API_BASE = "http://localhost:8000";

export default function App() {
  const [view, setView] = useState("LIST"); // LIST | CREATE | DETAIL
  const [rfqs, setRfqs] = useState([]);
  const [selectedRfq, setSelectedRfq] = useState(null);
  const [error, setError] = useState("");

  // Default timestamps helper for quick testing
  const getFutureIso = (mins) => {
    const d = new Date(Date.now() + mins * 60000);
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d - tzOffset).toISOString().slice(0, 16);
  };

  const [rfqForm, setRfqForm] = useState({
    reference_id: `RFQ-${Math.floor(100 + Math.random() * 900)}`,
    name: "Mumbai to Delhi FTL Shipment",
    bid_start_time: getFutureIso(0),
    bid_close_time: getFutureIso(8),
    forced_close_time: getFutureIso(20),
    pickup_date: "2026-11-20",
    trigger_window_x: 10,
    extension_duration_y: 5,
    trigger_type: "L1_RANK_CHANGE",
  });

  const [bidForm, setBidForm] = useState({
    carrier_name: "",
    freight_charges: "",
    origin_charges: "",
    dest_charges: "",
    transit_time: "3 Days",
    validity: "7 Days",
  });

  const fetchRfqs = async () => {
    const res = await fetch(`${API_BASE}/rfqs`);
    const data = await res.json();
    setRfqs(data);
  };

  const fetchRfqDetail = async (id) => {
    const res = await fetch(`${API_BASE}/rfqs/${id}`);
    if (res.ok) {
      const data = await res.json();
      setSelectedRfq(data);
    }
  };

  useEffect(() => {
    fetchRfqs();
    const timer = setInterval(() => {
      if (view === "LIST") fetchRfqs();
      if (view === "DETAIL" && selectedRfq) fetchRfqDetail(selectedRfq.id);
    }, 3000);
    return () => clearInterval(timer);
  }, [view, selectedRfq?.id]);

  const handleCreateRfq = async (e) => {
    e.preventDefault();
    setError("");
    const res = await fetch(`${API_BASE}/rfqs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...rfqForm,
        trigger_window_x: Number(rfqForm.trigger_window_x),
        extension_duration_y: Number(rfqForm.extension_duration_y),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.detail?.[0]?.msg || data.detail || "Failed to create RFQ");
      return;
    }
    fetchRfqs();
    setView("LIST");
  };

  const handleBidSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const res = await fetch(`${API_BASE}/rfqs/${selectedRfq.id}/bids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...bidForm,
        freight_charges: Number(bidForm.freight_charges),
        origin_charges: Number(bidForm.origin_charges),
        dest_charges: Number(bidForm.dest_charges),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.detail || "Error submitting bid");
      return;
    }
    setBidForm({ ...bidForm, carrier_name: "", freight_charges: "", origin_charges: "", dest_charges: "" });
    fetchRfqDetail(selectedRfq.id);
  };

  return (
    <div>
      <nav className="navbar">
        <h1>British Auction RFQ</h1>
        <div>
          {view !== "LIST" && (
            <button className="btn btn-secondary" onClick={() => { setView("LIST"); setError(""); }} style={{ marginRight: "8px" }}>
              ← Back to Auctions
            </button>
          )}
          <button className="btn" onClick={() => { setView("CREATE"); setError(""); }}>
            + Create RFQ
          </button>
        </div>
      </nav>

      <div className="container">
        {error && (
          <div className="card" style={{ background: "#fee2e2", color: "#b91c1c", borderColor: "#f87171" }}>
            {error}
          </div>
        )}

        {/* --- VIEW 1: LISTING PAGE --- */}
        {view === "LIST" && (
          <div className="card">
            <h2>Active & Past British Auctions</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>RFQ ID / Name</th>
                  <th>Lowest Bid (L1)</th>
                  <th>Current Bid Close</th>
                  <th>Forced Close Time</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rfqs.length === 0 ? (
                  <tr><td colSpan="6">No auctions created yet. Click "+ Create RFQ" to start.</td></tr>
                ) : (
                  rfqs.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.reference_id}</strong> — {r.name}</td>
                      <td>{r.lowest_bid ? `$${r.lowest_bid.toLocaleString()}` : "No bids yet"}</td>
                      <td>{new Date(r.bid_close_time).toLocaleString()}</td>
                      <td>{new Date(r.forced_close_time).toLocaleString()}</td>
                      <td>
                        <span className={`badge ${r.status.replace(" ", "-")}`}>{r.status}</span>
                      </td>
                      <td>
                        <button
                          className="btn"
                          onClick={() => {
                            fetchRfqDetail(r.id);
                            setView("DETAIL");
                          }}
                        >
                          View Room
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* --- VIEW 2: CREATE RFQ FORM --- */}
        {view === "CREATE" && (
          <div className="card">
            <h2>Create New British Auction RFQ</h2>
            <form onSubmit={handleCreateRfq} className="form-grid">
              <div className="form-group">
                <label>Reference ID</label>
                <input required value={rfqForm.reference_id} onChange={(e) => setRfqForm({ ...rfqForm, reference_id: e.target.value })} />
              </div>
              <div className="form-group">
                <label>RFQ Title / Service</label>
                <input required value={rfqForm.name} onChange={(e) => setRfqForm({ ...rfqForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Bid Start Time</label>
                <input type="datetime-local" required value={rfqForm.bid_start_time} onChange={(e) => setRfqForm({ ...rfqForm, bid_start_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Pickup / Service Date</label>
                <input type="date" required value={rfqForm.pickup_date} onChange={(e) => setRfqForm({ ...rfqForm, pickup_date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Initial Bid Close Time</label>
                <input type="datetime-local" required value={rfqForm.bid_close_time} onChange={(e) => setRfqForm({ ...rfqForm, bid_close_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Forced Bid Close Time (Must be &gt; Close Time)</label>
                <input type="datetime-local" required value={rfqForm.forced_close_time} onChange={(e) => setRfqForm({ ...rfqForm, forced_close_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Trigger Window X (Minutes)</label>
                <input type="number" min="1" required value={rfqForm.trigger_window_x} onChange={(e) => setRfqForm({ ...rfqForm, trigger_window_x: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Extension Duration Y (Minutes)</label>
                <input type="number" min="1" required value={rfqForm.extension_duration_y} onChange={(e) => setRfqForm({ ...rfqForm, extension_duration_y: e.target.value })} />
              </div>
              <div className="form-group" style={{ gridColumn: "span 2" }}>
                <label>Extension Trigger Condition</label>
                <select value={rfqForm.trigger_type} onChange={(e) => setRfqForm({ ...rfqForm, trigger_type: e.target.value })}>
                  <option value="ANY_BID">a) Bid Received in Last X Minutes</option>
                  <option value="ANY_RANK_CHANGE">b) Any Supplier Rank Change in Last X Minutes</option>
                  <option value="L1_RANK_CHANGE">c) Lowest Bidder (L1) Rank Change in Last X Minutes</option>
                </select>
              </div>
              <div style={{ gridColumn: "span 2", marginTop: "0.5rem" }}>
                <button type="submit" className="btn">Launch Auction</button>
              </div>
            </form>
          </div>
        )}

        {/* --- VIEW 3: AUCTION DETAILS & BIDDING ROOM --- */}
        {view === "DETAIL" && selectedRfq && (
          <div>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>{selectedRfq.reference_id}: {selectedRfq.name}</h2>
                <span className={`badge ${selectedRfq.status.replace(" ", "-")}`}>{selectedRfq.status}</span>
              </div>
              <div className="meta-strip">
                <div>Close Time: <strong>{new Date(selectedRfq.bid_close_time).toLocaleTimeString()}</strong></div>
                <div>Forced Stop: <strong>{new Date(selectedRfq.forced_close_time).toLocaleTimeString()}</strong></div>
                <div>Trigger Window (X): <strong>{selectedRfq.trigger_window_x} mins</strong></div>
                <div>Extension (Y): <strong>+{selectedRfq.extension_duration_y} mins</strong></div>
                <div>Rule: <strong>{selectedRfq.trigger_type}</strong></div>
              </div>
            </div>

            <div className="grid-2">
              {/* LEFT COLUMN: LIVE LEADERBOARD */}
              <div>
                <div className="card">
                  <h3>Live Supplier Leaderboard</h3>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Carrier</th>
                        <th>Total Price</th>
                        <th>Breakdown (F / O / D)</th>
                        <th>Transit & Validity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRfq.bids.length === 0 ? (
                        <tr><td colSpan="5">No quotes submitted yet.</td></tr>
                      ) : (
                        selectedRfq.bids.map((b) => (
                          <tr key={b.id}>
                            <td><span className={`rank-pill ${b.rank}`}>{b.rank}</span></td>
                            <td><strong>{b.carrier_name}</strong></td>
                            <td style={{ fontWeight: 700 }}>${b.total_price.toLocaleString()}</td>
                            <td style={{ color: "#64748b" }}>
                              ${b.freight_charges} / ${b.origin_charges} / ${b.dest_charges}
                            </td>
                            <td>{b.transit_time} • {b.validity}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* ACTIVITY LOGS */}
                <div className="card">
                  <h3>Auction Activity & Extension Log</h3>
                  <ul className="log-list">
                    {selectedRfq.logs.map((L) => (
                      <li key={L.id} className={`log-item ${L.event_type}`}>
                        <div style={{ fontWeight: 600 }}>
                          {L.event_type === "TIME_EXTENDED" ? "⏱ TIME EXTENDED" : "📝 " + L.event_type}
                        </div>
                        <div>{L.message}</div>
                        <small style={{ color: "#64748b" }}>{new Date(L.created_at).toLocaleTimeString()}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* RIGHT COLUMN: SUBMIT QUOTE FORM */}
              <div className="card" style={{ height: "fit-content" }}>
                <h3>Submit Supplier Quote</h3>
                <form onSubmit={handleBidSubmit} className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="form-group">
                    <label>Carrier / Supplier Name</label>
                    <input required placeholder="e.g., BlueDart Logistics" value={bidForm.carrier_name} onChange={(e) => setBidForm({ ...bidForm, carrier_name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Freight Charges ($)</label>
                    <input type="number" step="0.01" required placeholder="800" value={bidForm.freight_charges} onChange={(e) => setBidForm({ ...bidForm, freight_charges: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Origin Charges ($)</label>
                    <input type="number" step="0.01" required placeholder="100" value={bidForm.origin_charges} onChange={(e) => setBidForm({ ...bidForm, origin_charges: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Destination Charges ($)</label>
                    <input type="number" step="0.01" required placeholder="50" value={bidForm.dest_charges} onChange={(e) => setBidForm({ ...bidForm, dest_charges: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Transit Time</label>
                    <input required value={bidForm.transit_time} onChange={(e) => setBidForm({ ...bidForm, transit_time: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Quote Validity</label>
                    <input required value={bidForm.validity} onChange={(e) => setBidForm({ ...bidForm, validity: e.target.value })} />
                  </div>
                  <button type="submit" className="btn" disabled={selectedRfq.status !== "Active"}>
                    {selectedRfq.status === "Active" ? "Place Competitive Bid" : `Bidding ${selectedRfq.status}`}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}