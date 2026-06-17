#!/usr/bin/env python3
"""Build the Tanawin portfolio PDF from the demo screenshots."""
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "docs", "screenshots-v2")
OUT = os.path.join(ROOT, "docs", "Tanawin-Operating-Expenses-Demo.pdf")

MAROON = (0.60, 0.21, 0.09)      # #9A3518
SAND_BG = (0.984, 0.980, 0.965)  # #FBFAF6
INK = (0.12, 0.106, 0.086)       # #1F1B16
INK_MUT = (0.43, 0.40, 0.35)     # muted

W, H = letter  # 612 x 792

PAGES = [
    ("01-login.png", "Sign in", "Pick your name — no usernames to remember. Admin, staff, and a view-only Guest for accountants and family."),
    ("02-dashboard.png", "Owner dashboard", "Petty-cash balance, what needs review, a one-tap expense log, and spend by tag as a pie or bar chart."),
    ("11-analytics.png", "Analytics & insights", "Tap a chart to drill in. Filter by month(s) and tag with checkboxes; see spend by staff and funding source, trends, and plain-language recommendations."),
    ("03-entries.png", "Expense ledger", "Every expense and top-up, colour-coded by funding source (petty cash vs. other), searchable and filterable by month."),
    ("13-excel-export.png", "Excel export", "Export to Excel by month, several months, or a whole year. The workbook lands clean: sorted by date, money formatted, internal IDs dropped."),
    ("14-bulk-correct.png", "Bulk corrections", "Select several entries and fix them in one go — move them to the right month, or set the category or funding source across the whole selection."),
    ("04-entry-detail.png", "Entry & receipt", "Each line item links to its receipt photo, edit history, and an internal note thread."),
    ("05-review.png", "Review queue", "Duplicates, arithmetic slips, and unusual amounts are flagged automatically; top-ups await the owner's approval."),
    ("10-pcf.png", "Petty cash", "Top-ups are reported by staff and approved or rejected with a reason; every expense draws the balance down."),
    ("06-gallery.png", "Receipt gallery", "All captured receipts with live reconciliation status — reconciled, mismatch, or still unfinished."),
    ("07-receipt.png", "Receipt tools", "Replace a blurry photo, add a missing item, split or delete a line, or mark complete when part was a personal purchase."),
    ("08-staff-home.png", "Staff home", "Staff see the balance, their own spend, and anything the owner has asked them to follow up on."),
    ("09-log-expense.png", "Log an expense", "One receipt, many tagged items, with a smart category suggestion and a live check against the printed total."),
    ("12-guest-feed.png", "View-only guest", "Accountants and family sign in as a read-only Guest — they browse the ledger, see spend by tag, and open full analytics, but can't edit or log anything."),
]


def draw_bg(c):
    c.setFillColorRGB(*SAND_BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)


def cover(c):
    draw_bg(c)
    # maroon band
    c.setFillColorRGB(*MAROON)
    c.rect(0, H - 3.1 * inch, W, 3.1 * inch, fill=1, stroke=0)
    # app icon tile
    icon = os.path.join(ROOT, "public", "icons", "icon-512.png")
    if os.path.exists(icon):
        c.drawImage(ImageReader(icon), W / 2 - 0.55 * inch, H - 2.15 * inch,
                    width=1.1 * inch, height=1.1 * inch, mask='auto')
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 26)
    c.drawCentredString(W / 2, H - 2.7 * inch, "Tanawin Operating Expenses")

    c.setFillColorRGB(*INK)
    c.setFont("Helvetica", 13)
    c.drawCentredString(W / 2, H - 3.75 * inch,
                        "A mobile expense tracker for a bed-and-breakfast.")
    c.setFillColorRGB(*INK_MUT)
    c.setFont("Helvetica", 11)
    lines = [
        "Staff log market runs and bills from their phones. The owner reviews,",
        "approves petty-cash top-ups, reconciles receipts, and hands clean",
        "books to the accountant.",
    ]
    y = H - 4.25 * inch
    for ln in lines:
        c.drawCentredString(W / 2, y, ln)
        y -= 0.24 * inch

    # feature chips
    feats = ["Multi-item receipts", "Petty-cash approvals", "Role-based access",
             "Auto-flagging & review", "Excel + receipts export", "Installs to home screen"]
    c.setFont("Helvetica", 10)
    cy = H - 5.4 * inch
    for i, f in enumerate(feats):
        col = i % 2
        x = W / 2 - 2.4 * inch + col * 2.5 * inch
        yy = cy - (i // 2) * 0.34 * inch
        c.setFillColorRGB(*MAROON)
        c.circle(x, yy + 0.03 * inch, 0.035 * inch, fill=1, stroke=0)
        c.setFillColorRGB(*INK)
        c.drawString(x + 0.16 * inch, yy, f)

    c.setFillColorRGB(*INK_MUT)
    c.setFont("Helvetica-Oblique", 9)
    c.drawCentredString(W / 2, 0.9 * inch,
                        "All names, vendors, amounts, and receipts shown are fictional demo data.")
    c.setFont("Helvetica", 9)
    c.drawCentredString(W / 2, 0.66 * inch,
                        "Next.js  ·  React  ·  TypeScript  ·  Tailwind  ·  Supabase  ·  Cloudflare Pages")
    c.showPage()


def shot_page(c, items):
    """Up to 2 phone screenshots side by side with captions."""
    draw_bg(c)
    n = len(items)
    slot_w = W / n
    img_max_w = 3.35 * inch
    top = H - 0.6 * inch
    for i, (fn, title, cap) in enumerate(items):
        cx = slot_w * (i + 0.5)
        path = os.path.join(SHOTS, fn)
        iw, ih = Image.open(path).size
        scale = min(img_max_w / iw, 8.0 * inch / ih)
        w, h = iw * scale, ih * scale
        # title
        c.setFillColorRGB(*MAROON)
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(cx, top, title)
        # image with subtle border
        ix, iy = cx - w / 2, top - 0.28 * inch - h
        c.setStrokeColorRGB(0.85, 0.82, 0.74)
        c.setLineWidth(0.75)
        c.rect(ix - 1, iy - 1, w + 2, h + 2, fill=0, stroke=1)
        c.drawImage(ImageReader(path), ix, iy, width=w, height=h, mask='auto')
        # caption
        c.setFillColorRGB(*INK_MUT)
        c.setFont("Helvetica", 8.5)
        words, line, ty = cap.split(), "", iy - 0.22 * inch
        maxw = slot_w - 0.5 * inch
        for word in words:
            test = (line + " " + word).strip()
            if c.stringWidth(test, "Helvetica", 8.5) > maxw:
                c.drawCentredString(cx, ty, line)
                ty -= 0.16 * inch
                line = word
            else:
                line = test
        if line:
            c.drawCentredString(cx, ty, line)
    # footer
    c.setFillColorRGB(*INK_MUT)
    c.setFont("Helvetica-Oblique", 8)
    c.drawCentredString(W / 2, 0.5 * inch, "Tanawin Operating Expenses — demo data")
    c.showPage()


def main():
    c = canvas.Canvas(OUT, pagesize=letter)
    c.setTitle("Tanawin Operating Expenses — Demo")
    cover(c)
    for i in range(0, len(PAGES), 2):
        shot_page(c, PAGES[i:i + 2])
    c.save()
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
