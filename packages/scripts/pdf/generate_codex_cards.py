#!/usr/bin/env python3
"""
Oracle Hunt Codex Card PDF Generator

Usage:
    python generate_codex_cards.py codex_data.json
    python generate_codex_cards.py codex_data.json --output-dir ./cards

Input JSON format:
    [
      {
        "name": "Alice Smith",
        "wallet_address": "GABC...XYZ",
        "zk_fingerprint": "a1b2c3d4...",
        "artifacts": [
          {"oracle_name": "The Seer", "artifact_text": "...", "prompt": "..."},
          ...
        ]
      },
      ...
    ]

Output:
    ./cards/Alice_Smith_codex_card.pdf  (per participant)
    ./cards/all_cards_combined.pdf      (print-ready combined)
"""

import argparse
import json
import os
import sys
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
    KeepInFrame, Table, TableStyle
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Card dimensions: 5.5" x 8.5" (half-letter, folded) ─────────────────────
CARD_W = 5.5 * inch
CARD_H = 8.5 * inch
MARGIN = 0.5 * inch

# ── Brand colors ─────────────────────────────────────────────────────────────
NAVY = colors.HexColor('#0D1B5E')
ACCENT = colors.HexColor('#1B4FD8')
LIGHT_BLUE = colors.HexColor('#EEF3FF')
WHITE = colors.white
MID_GRAY = colors.HexColor('#6B7280')

ORACLE_EMOJI = {
    'The Seer': '🔮',
    'The Painter': '🎨',
    'The Composer': '🎵',
    'The Scribe': '📜',
    'The Scholar': '📚',
    'The Informant': '🕵',
    'The Hidden Oracle': '🗝',
}


def truncate_address(addr: str, head: int = 8, tail: int = 8) -> str:
    if len(addr) <= head + tail + 3:
        return addr
    return f"{addr[:head]}…{addr[-tail:]}"


def build_styles() -> dict:
    return {
        'title': ParagraphStyle(
            'title',
            fontName='Helvetica-Bold',
            fontSize=20,
            textColor=WHITE,
            alignment=TA_CENTER,
            spaceAfter=4,
        ),
        'subtitle': ParagraphStyle(
            'subtitle',
            fontName='Helvetica',
            fontSize=9,
            textColor=colors.HexColor('#A5B4FC'),
            alignment=TA_CENTER,
            spaceAfter=2,
        ),
        'wallet': ParagraphStyle(
            'wallet',
            fontName='Courier',
            fontSize=7,
            textColor=colors.HexColor('#93C5FD'),
            alignment=TA_CENTER,
            spaceAfter=0,
        ),
        'fingerprint_label': ParagraphStyle(
            'fingerprint_label',
            fontName='Helvetica-Bold',
            fontSize=7,
            textColor=ACCENT,
            spaceBefore=8,
            spaceAfter=4,
        ),
        'fingerprint': ParagraphStyle(
            'fingerprint',
            fontName='Courier',
            fontSize=6.5,
            textColor=colors.HexColor('#4B7BF5'),
            leading=10,
            wordWrap='CJK',
        ),
        'oracle_name': ParagraphStyle(
            'oracle_name',
            fontName='Helvetica-Bold',
            fontSize=9,
            textColor=ACCENT,
            spaceAfter=3,
        ),
        'artifact': ParagraphStyle(
            'artifact',
            fontName='Helvetica',
            fontSize=8.5,
            textColor=NAVY,
            leading=13,
            spaceAfter=4,
        ),
        'prompt': ParagraphStyle(
            'prompt',
            fontName='Helvetica-Oblique',
            fontSize=7,
            textColor=MID_GRAY,
            spaceAfter=4,
        ),
        'section_label': ParagraphStyle(
            'section_label',
            fontName='Helvetica-Bold',
            fontSize=7,
            textColor=MID_GRAY,
            spaceBefore=10,
            spaceAfter=6,
        ),
    }


class CodexCardCanvas(canvas.Canvas):
    """Custom canvas that draws the navy header background."""

    def __init__(self, filename, participant: dict, **kwargs):
        super().__init__(filename, pagesize=(CARD_W, CARD_H), **kwargs)
        self.participant = participant
        self._draw_header_background()

    def _draw_header_background(self):
        header_h = 2.1 * inch
        self.setFillColor(NAVY)
        self.rect(0, CARD_H - header_h, CARD_W, header_h, fill=1, stroke=0)

        # Decorative accent line
        self.setStrokeColor(ACCENT)
        self.setLineWidth(2)
        self.line(0, CARD_H - header_h, CARD_W, CARD_H - header_h)

        # Subtle star dots
        self.setFillColor(colors.HexColor('#FFFFFF'))
        import random
        rng = random.Random(self.participant.get('wallet_address', 'seed'))
        for _ in range(20):
            x = rng.uniform(0, CARD_W)
            y = rng.uniform(CARD_H - header_h + 10, CARD_H - 10)
            r = rng.uniform(0.5, 1.5)
            self.setFillAlpha(rng.uniform(0.1, 0.4))
            self.circle(x, y, r, fill=1, stroke=0)
        self.setFillAlpha(1)


def generate_card(participant: dict, output_path: str, styles: dict):
    """Generate a single Codex Card PDF for one participant."""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=(CARD_W, CARD_H),
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=2.2 * inch,   # Leave room for navy header
        bottomMargin=0.4 * inch,
    )

    story = []

    # ── Artifacts section ─────────────────────────────────────────────────
    artifacts = participant.get('artifacts', [])[:3]  # Max 3

    if artifacts:
        story.append(Paragraph('ORACLE ARTIFACTS', styles['section_label']))

        for i, artifact in enumerate(artifacts):
            oracle_name = artifact.get('oracle_name', 'Oracle')
            emoji = ORACLE_EMOJI.get(oracle_name, '✦')
            artifact_text = artifact.get('artifact_text', '')
            prompt_text = artifact.get('prompt', '')

            # Oracle name row
            story.append(Paragraph(f"{emoji}  {oracle_name.upper()}", styles['oracle_name']))

            if prompt_text:
                short_prompt = prompt_text[:120] + ('…' if len(prompt_text) > 120 else '')
                story.append(Paragraph(f'"{short_prompt}"', styles['prompt']))

            # Artifact text (limited height to fit on card)
            short_artifact = artifact_text[:400] + ('…' if len(artifact_text) > 400 else '')
            story.append(Paragraph(short_artifact, styles['artifact']))

            if i < len(artifacts) - 1:
                story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#E5E7EB')))
                story.append(Spacer(1, 6))

    # ── ZK Fingerprint ────────────────────────────────────────────────────
    fingerprint = participant.get('zk_fingerprint', '')
    if fingerprint:
        story.append(Spacer(1, 8))
        story.append(Paragraph('ZERO-KNOWLEDGE IDENTITY FINGERPRINT', styles['fingerprint_label']))

        # Draw a navy background box for the fingerprint
        fp_table = Table(
            [[Paragraph(fingerprint, styles['fingerprint'])]],
            colWidths=[CARD_W - 2 * MARGIN],
        )
        fp_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), NAVY),
            ('ROUNDEDCORNERS', [4]),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(fp_table)

    def _draw_header(c: canvas.Canvas, doc):
        """Draw the navy header with participant name and wallet address."""
        header_h = 2.1 * inch
        top = CARD_H

        # Header background
        c.setFillColor(NAVY)
        c.rect(0, top - header_h, CARD_W, header_h, fill=1, stroke=0)

        # Accent line
        c.setStrokeColor(ACCENT)
        c.setLineWidth(2)
        c.line(0, top - header_h, CARD_W, top - header_h)

        # Oracle Hunt wordmark
        c.setFillColor(colors.HexColor('#A5B4FC'))
        c.setFont('Helvetica', 7)
        c.drawCentredString(CARD_W / 2, top - 0.25 * inch, 'ORACLE HUNT')

        # Participant name
        name = participant.get('name', 'Unknown')
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 18)
        c.drawCentredString(CARD_W / 2, top - 0.7 * inch, name)

        # Wallet address
        wallet = truncate_address(participant.get('wallet_address', ''), head=10, tail=10)
        c.setFillColor(colors.HexColor('#93C5FD'))
        c.setFont('Courier', 7)
        c.drawCentredString(CARD_W / 2, top - 1.05 * inch, wallet)

        # Completion badge
        n_oracles = len(set(a.get('oracle_name') for a in participant.get('artifacts', [])))
        badge_text = f'{n_oracles}/5 Oracles' + (' · COMPLETE' if n_oracles >= 5 else '')
        c.setFillColor(ACCENT)
        badge_w = 1.4 * inch
        badge_h = 0.22 * inch
        c.roundRect(
            CARD_W / 2 - badge_w / 2, top - 1.4 * inch,
            badge_w, badge_h, 4, fill=1, stroke=0
        )
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 7)
        c.drawCentredString(CARD_W / 2, top - 1.32 * inch, badge_text)

        # Subtle star dots
        import random
        rng = random.Random(participant.get('wallet_address', 'seed'))
        c.setFillColor(WHITE)
        for _ in range(15):
            x = rng.uniform(MARGIN / 2, CARD_W - MARGIN / 2)
            y = rng.uniform(top - header_h + 8, top - 0.15 * inch)
            r = rng.uniform(0.5, 1.2)
            c.setFillAlpha(rng.uniform(0.08, 0.3))
            c.circle(x, y, r, fill=1, stroke=0)
        c.setFillAlpha(1)

    doc.build(story, onFirstPage=_draw_header, onLaterPages=_draw_header)


def generate_all(input_path: str, output_dir: str):
    with open(input_path) as f:
        participants = json.load(f)

    os.makedirs(output_dir, exist_ok=True)
    styles = build_styles()
    individual_paths = []

    print(f'\nGenerating Codex Cards for {len(participants)} participants…\n')

    for i, participant in enumerate(participants):
        name = participant.get('name', f'Participant_{i + 1}')
        safe_name = name.replace(' ', '_').replace('/', '_')
        output_path = os.path.join(output_dir, f'{safe_name}_codex_card.pdf')

        generate_card(participant, output_path, styles)
        individual_paths.append(output_path)
        print(f'  [{i + 1}/{len(participants)}] {name} → {output_path}')

    # Generate combined PDF
    combined_path = os.path.join(output_dir, 'all_cards_combined.pdf')
    merge_pdfs(individual_paths, combined_path)

    print(f'\n✓ {len(participants)} individual cards generated')
    print(f'✓ Combined PDF: {combined_path}')
    print(f'\nSend {combined_path} to your print vendor.')
    print('Spec: 5.5" × 8.5" half-letter, scored for fold, full bleed on navy header.\n')


def merge_pdfs(input_paths: list[str], output_path: str):
    """Merge multiple PDFs into one print-ready file using ReportLab."""
    from reportlab.platypus import SimpleDocTemplate as SDT
    from PyPDF2 import PdfMerger  # type: ignore[import]

    try:
        merger = PdfMerger()
        for p in input_paths:
            merger.append(p)
        with open(output_path, 'wb') as f:
            merger.write(f)
        merger.close()
    except ImportError:
        # PyPDF2 not installed — just note that individual files are ready
        print('  (Install PyPDF2 to auto-generate combined PDF: pip install PyPDF2)')
        print(f'  Individual PDFs are in {os.path.dirname(output_path)}')


def main():
    parser = argparse.ArgumentParser(description='Generate Oracle Hunt Codex Card PDFs')
    parser.add_argument('input', help='Path to codex_data.json')
    parser.add_argument('--output-dir', default='./cards', help='Output directory (default: ./cards)')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f'Error: {args.input} not found', file=sys.stderr)
        sys.exit(1)

    generate_all(args.input, args.output_dir)


if __name__ == '__main__':
    main()
