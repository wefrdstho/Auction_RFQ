from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship


SQLALCHEMY_DATABASE_URL = "sqlite:///./rfq_auction.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class RFQModel(Base):
    __tablename__ = "rfqs"
    id = Column(Integer, primary_key=True, index=True)
    reference_id = Column(String, unique=True, index=True)
    name = Column(String)
    bid_start_time = Column(DateTime)
    bid_close_time = Column(DateTime)
    forced_close_time = Column(DateTime)
    pickup_date = Column(String)
    trigger_window_x = Column(Integer)      # X minutes
    extension_duration_y = Column(Integer)  # Y minutes
    trigger_type = Column(String)           # ANY_BID | ANY_RANK_CHANGE | L1_RANK_CHANGE

    bids = relationship("BidModel", back_populates="rfq", cascade="all, delete-orphan")
    logs = relationship("ActivityLogModel", back_populates="rfq", cascade="all, delete-orphan")

class BidModel(Base):
    __tablename__ = "bids"
    id = Column(Integer, primary_key=True, index=True)
    rfq_id = Column(Integer, ForeignKey("rfqs.id"))
    carrier_name = Column(String)
    freight_charges = Column(Float)
    origin_charges = Column(Float)
    dest_charges = Column(Float)
    total_price = Column(Float)
    transit_time = Column(String)
    validity = Column(String)
    created_at = Column(DateTime, default=datetime.now)

    rfq = relationship("RFQModel", back_populates="bids")

class ActivityLogModel(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True, index=True)
    rfq_id = Column(Integer, ForeignKey("rfqs.id"))
    event_type = Column(String)  # BID_SUBMITTED or TIME_EXTENDED
    message = Column(String)
    created_at = Column(DateTime, default=datetime.now)

    rfq = relationship("RFQModel", back_populates="logs")

Base.metadata.create_all(bind=engine)

# Schemas for validation
class RFQCreate(BaseModel):
    reference_id: str
    name: str
    bid_start_time: datetime
    bid_close_time: datetime
    forced_close_time: datetime
    pickup_date: str
    trigger_window_x: int
    extension_duration_y: int
    trigger_type: str

    @validator("forced_close_time")
    def validate_forced_close(cls, v, values):
        if "bid_close_time" in values and v <= values["bid_close_time"]:
            raise ValueError("Forced Bid Close Time must be greater than Bid Close Time.")
        return v

class BidCreate(BaseModel):
    carrier_name: str
    freight_charges: float
    origin_charges: float
    dest_charges: float
    transit_time: str
    validity: str

# FastAPI INIT
app = FastAPI(title="British Auction RFQ System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def compute_status(rfq: RFQModel) -> str:
    now = datetime.now()
    if now >= rfq.forced_close_time:
        return "Force Closed"
    if now >= rfq.bid_close_time:
        return "Closed"
    return "Active"

def get_supplier_rankings(bids: List[BidModel]) -> List[dict]:
    """
    Takes all bids, keeps each supplier's best (lowest) bid or ranks all bids by price
    and returns sorted bids with L1, L2, L3 labels.
    """
    sorted_bids = sorted(bids, key=lambda b: (b.total_price, b.created_at))
    ranked = []
    for idx, b in enumerate(sorted_bids):
        ranked.append({
            "id": b.id,
            "rank": f"L{idx + 1}",
            "carrier_name": b.carrier_name,
            "freight_charges": b.freight_charges,
            "origin_charges": b.origin_charges,
            "dest_charges": b.dest_charges,
            "total_price": b.total_price,
            "transit_time": b.transit_time,
            "validity": b.validity,
            "created_at": b.created_at
        })
    return ranked

# Routes

@app.post("/rfqs")
def create_rfq(payload: RFQCreate, db: Session = Depends(get_db)):
    existing = db.query(RFQModel).filter(RFQModel.reference_id == payload.reference_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="RFQ Reference ID already exists.")

    rfq = RFQModel(**payload.dict())
    db.add(rfq)
    db.commit()
    db.refresh(rfq)

    log = ActivityLogModel(
        rfq_id=rfq.id,
        event_type="AUCTION_CREATED",
        message=f"RFQ {rfq.reference_id} created. Close: {rfq.bid_close_time.strftime('%H:%M:%S')}."
    )
    db.add(log)
    db.commit()
    return rfq

@app.get("/rfqs")
def list_rfqs(db: Session = Depends(get_db)):
    rfqs = db.query(RFQModel).order_by(RFQModel.id.desc()).all()
    result = []
    for r in rfqs:
        lowest_bid = min([b.total_price for b in r.bids], default=None)
        result.append({
            "id": r.id,
            "reference_id": r.reference_id,
            "name": r.name,
            "lowest_bid": lowest_bid,
            "bid_close_time": r.bid_close_time,
            "forced_close_time": r.forced_close_time,
            "status": compute_status(r)
        })
    return result

@app.get("/rfqs/{rfq_id}")
def get_rfq_details(rfq_id: int, db: Session = Depends(get_db)):
    rfq = db.query(RFQModel).filter(RFQModel.id == rfq_id).first()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")

    ranked_bids = get_supplier_rankings(rfq.bids)
    logs = sorted(rfq.logs, key=lambda l: l.created_at, reverse=True)

    return {
        "id": rfq.id,
        "reference_id": rfq.reference_id,
        "name": rfq.name,
        "pickup_date": rfq.pickup_date,
        "bid_start_time": rfq.bid_start_time,
        "bid_close_time": rfq.bid_close_time,
        "forced_close_time": rfq.forced_close_time,
        "trigger_window_x": rfq.trigger_window_x,
        "extension_duration_y": rfq.extension_duration_y,
        "trigger_type": rfq.trigger_type,
        "status": compute_status(rfq),
        "bids": ranked_bids,
        "logs": logs
    }

@app.post("/rfqs/{rfq_id}/bids")
def submit_bid(rfq_id: int, payload: BidCreate, db: Session = Depends(get_db)):
    rfq = db.query(RFQModel).filter(RFQModel.id == rfq_id).first()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")

    now = datetime.now()
    status = compute_status(rfq)
    if status != "Active":
        raise HTTPException(status_code=400, detail=f"Cannot place bid. Auction is {status}.")

    # 1. Capture rankings BEFORE adding the new bid
    old_rankings = get_supplier_rankings(rfq.bids)
    old_l1_carrier = old_rankings[0]["carrier_name"] if old_rankings else None
    old_l1_price = old_rankings[0]["total_price"] if old_rankings else None
    old_carrier_order = [b["carrier_name"] for b in old_rankings]

    # 2. Save the new bid
    total_price = payload.freight_charges + payload.origin_charges + payload.dest_charges
    new_bid = BidModel(
        rfq_id=rfq.id,
        carrier_name=payload.carrier_name,
        freight_charges=payload.freight_charges,
        origin_charges=payload.origin_charges,
        dest_charges=payload.dest_charges,
        total_price=total_price,
        transit_time=payload.transit_time,
        validity=payload.validity,
        created_at=now
    )
    db.add(new_bid)
    db.commit()
    db.refresh(rfq)

    # Log the bid submission
    bid_log = ActivityLogModel(
        rfq_id=rfq.id,
        event_type="BID_SUBMITTED",
        message=f"{payload.carrier_name} submitted a quote of ${total_price:,.2f}",
        created_at=now
    )
    db.add(bid_log)

    # 3. Capturing rankings after the new bid
    new_rankings = get_supplier_rankings(rfq.bids)
    new_l1_carrier = new_rankings[0]["carrier_name"] if new_rankings else None
    new_l1_price = new_rankings[0]["total_price"] if new_rankings else None
    new_carrier_order = [b["carrier_name"] for b in new_rankings]

    # 4. Check if inside Trigger Window (X minutes before current bid_close_time)
    window_start = rfq.bid_close_time - timedelta(minutes=rfq.trigger_window_x)
    in_trigger_window = window_start <= now <= rfq.bid_close_time

    if in_trigger_window:
        should_extend = False
        reason = ""

        if rfq.trigger_type == "ANY_BID":
            should_extend = True
            reason = f"Bid received from {payload.carrier_name} within last {rfq.trigger_window_x} mins"

        elif rfq.trigger_type == "ANY_RANK_CHANGE":
            # Check if the new bid inserted above the bottom or changed existing positions
            new_bid_rank = next((i for i, b in enumerate(new_rankings) if b["id"] == new_bid.id), -1)
            if len(old_carrier_order) > 0 and (new_bid_rank < len(new_rankings) - 1 or old_carrier_order != new_carrier_order[:-1]):
                should_extend = True
                reason = f"Supplier ranking shifted (New bid ranked L{new_bid_rank + 1}) within last {rfq.trigger_window_x} mins"

        elif rfq.trigger_type == "L1_RANK_CHANGE":
            # Extend if L1 price dropped or a new L1 carrier took the lead
            if old_l1_price is None or (new_l1_price < old_l1_price) or (new_l1_carrier != old_l1_carrier):
                should_extend = True
                reason = f"New Lowest Bidder (L1: {new_l1_carrier} at ${new_l1_price:,.2f}) in last {rfq.trigger_window_x} mins"

        # 5. Apply Extension (Capped at Forced Close Time)
        if should_extend and rfq.bid_close_time < rfq.forced_close_time:
            old_close = rfq.bid_close_time
            proposed_close = rfq.bid_close_time + timedelta(minutes=rfq.extension_duration_y)

            if proposed_close >= rfq.forced_close_time:
                rfq.bid_close_time = rfq.forced_close_time
                cap_note = " (Capped at Forced Close Time)"
            else:
                rfq.bid_close_time = proposed_close
                cap_note = ""

            ext_log = ActivityLogModel(
                rfq_id=rfq.id,
                event_type="TIME_EXTENDED",
                message=(
                    f"Close time extended from {old_close.strftime('%H:%M:%S')} to "
                    f"{rfq.bid_close_time.strftime('%H:%M:%S')}{cap_note}. Reason: {reason}."
                ),
                created_at=now
            )
            db.add(ext_log)

    db.commit()
    return {"message": "Bid submitted successfully"}