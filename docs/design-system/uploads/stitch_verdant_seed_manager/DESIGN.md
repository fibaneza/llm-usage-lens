---
name: Botanical Heritage
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0edec'
  surface-container-high: '#ebe7e7'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#444845'
  inverse-surface: '#313030'
  inverse-on-surface: '#f3f0ef'
  outline: '#747875'
  outline-variant: '#c4c7c4'
  surface-tint: '#5e5e5d'
  primary: '#5e5e5d'
  on-primary: '#ffffff'
  primary-container: '#f9f8f6'
  on-primary-container: '#717270'
  inverse-primary: '#c7c6c5'
  secondary: '#5f5e5b'
  on-secondary: '#ffffff'
  secondary-container: '#e1dfda'
  on-secondary-container: '#63635f'
  tertiary: '#605e59'
  on-tertiary: '#ffffff'
  tertiary-container: '#fbf8f0'
  on-tertiary-container: '#73726c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3e2e0'
  primary-fixed-dim: '#c7c6c5'
  on-primary-fixed: '#1a1c1b'
  on-primary-fixed-variant: '#464746'
  secondary-fixed: '#e4e2dd'
  secondary-fixed-dim: '#c8c6c2'
  on-secondary-fixed: '#1b1c19'
  on-secondary-fixed-variant: '#474743'
  tertiary-fixed: '#e5e2db'
  tertiary-fixed-dim: '#c9c6bf'
  on-tertiary-fixed: '#1c1c17'
  on-tertiary-fixed-variant: '#484742'
  background: '#fcf9f8'
  on-background: '#1c1b1b'
  surface-variant: '#e5e2e1'
typography:
  display-lg:
    fontFamily: Playfair Display
    fontSize: 64px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Playfair Display
    fontSize: 40px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Playfair Display
    fontSize: 28px
    fontWeight: '500'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Libre Franklin
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Libre Franklin
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: Libre Franklin
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
spacing:
  unit: 8px
  container-max: 1200px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
---

## Brand & Style

The brand personality is defined as a **Minimalist Archive**. It evokes the quiet, disciplined atmosphere of a high-end gallery or a historical preservation vault. The design system prioritizes clarity, structural integrity, and a sense of timelessness, moving away from organic vibrancy toward a curated, intellectual aesthetic.

The visual style is a blend of **Minimalism** and **High-Contrast Editorial**. By utilizing a monochromatic palette and generous negative space, the interface acts as a neutral canvas that elevates content—whether photography, text, or data—to the status of an artifact. The emotional response is one of calm, focus, and prestige.

## Colors

The palette is a sophisticated scale of whites and achromatic tones, completely devoid of chroma. 

- **Primary (Ivory):** Used as the foundational surface color to provide a warmer, more "archival paper" feel than a clinical pure white.
- **Secondary (Off-White):** Employed for subtle UI layering and container backgrounds.
- **Tertiary (Stone Grey):** Reserved for borders, dividers, and inactive states.
- **Neutral (Charcoal Black):** Used exclusively for typography and high-priority actions to ensure maximum legibility and a sharp, editorial contrast.

Avoid all green or colored tints. The depth is achieved through the interaction of these subtle tonal shifts rather than hue.

## Typography

This design system utilizes a high-contrast typographic pairing to reinforce the archival theme. 

**Playfair Display** is used for all headlines and display text. Its high-contrast serifs and elegant terminals provide a sense of historical authority and luxury. **Libre Franklin** serves as the functional counterpart for body copy and labels. Its clean, neo-grotesque structure ensures high legibility and a systematic, modern feel.

For labels, always use uppercase with slight letter spacing to mimic the look of museum placards and cataloging systems.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy on desktop to maintain the rigorous structure of a printed publication. A 12-column grid is used with generous margins to create an "airy" and expansive feel.

- **Desktop:** 64px outer margins provide a luxurious frame for content.
- **Mobile:** Margins compress to 20px, transitioning to a fluid single-column stack.
- **Rhythm:** All spacing is derived from an 8px base unit. Vertical rhythm is strictly enforced to ensure that elements feel anchored and intentional, rather than floating. 

Heavy use of whitespace is encouraged to separate distinct sections, replacing the need for heavy lines or background colors.

## Elevation & Depth

To maintain the Minimalist Archive aesthetic, this design system avoids traditional shadows. Depth is communicated through **Tonal Layering** and **Low-Contrast Outlines**.

1.  **Base Layer:** The Primary Ivory (#F9F8F6) surface.
2.  **Raised Layer:** Elements that sit "above" the base use a Secondary Off-White (#E8E6E1) or a pure white to create a subtle lift.
3.  **Outlines:** A 1px solid border in Tertiary (#D1CEC7) is used to define boundaries for inputs and cards.
4.  **Emphasis:** On hover or interaction, borders may transition to the Neutral Charcoal (#121212), creating a sharp visual "pop" without changing the physical elevation.

## Shapes

The shape language is **Sharp (0)**. Every UI element—including buttons, input fields, and images—uses 90-degree corners. This evokes the precision of architectural blueprints and the crisp edges of cut paper. 

Avoid rounded corners entirely, as they introduce an "app-like" softness that conflicts with the serious, archival nature of the design. Precision and geometry are the guiding principles here.

## Components

### Buttons
Primary buttons are solid Charcoal (#121212) with white Libre Franklin text. Secondary buttons are outlined with a 1px Stone Grey border and charcoal text. All buttons are rectangular with zero corner radius.

### Input Fields
Fields consist of a 1px Stone Grey bottom border or a full 1px box. Labels sit above the field in uppercase Label-MD style. Focus states are indicated by the border darkening to Charcoal.

### Cards
Cards are flat, defined by a Secondary Off-White background or a 1px Tertiary border. No shadows. Imagery within cards should maintain the sharp-cornered aesthetic.

### Chips & Tags
Chips are styled as small, rectangular boxes with thin borders. They should look like physical labels or indices.

### Lists
Lists are separated by thin, full-width horizontal rules in #D1CEC7. Ensure ample vertical padding (at least 24px) between list items to maintain the "airy" feel.