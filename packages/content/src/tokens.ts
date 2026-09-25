// Generated from ../tokens.json by scripts/build-tokens.ts. Do not edit.
export const tokens = {
  "$description": "Drunkify V1 design tokens. One visual system for every theme. Themes change content only (see themes/*.json). Colour modes: dark (default) and light (user display setting).",
  "color": {
    "dark": {
      "bg": {
        "value": "#23160E",
        "use": "App background (dark wood)"
      },
      "surface": {
        "value": "#301F14",
        "use": "Sheets, blocks, cards"
      },
      "surface2": {
        "value": "#3F2B1C",
        "use": "Chips, tiles, steppers, highlighted rows, raised elements on surface"
      },
      "ink": {
        "value": "#FFF3DE",
        "use": "Primary text (foam white)"
      },
      "muted": {
        "value": "#CFB696",
        "use": "Secondary text, inactive icons and tabs"
      },
      "accent": {
        "value": "#F4A73B",
        "use": "Primary fill: buttons, selected chips, bars, progress"
      },
      "accentText": {
        "value": "#F4A73B",
        "use": "Accent used as text or icon colour on bg/surface"
      },
      "onAccent": {
        "value": "#24160C",
        "use": "Text and icons on accent fills"
      },
      "line": {
        "value": "rgba(255,243,222,0.14)",
        "use": "Hairlines, borders, dividers"
      },
      "ring": {
        "value": "rgba(244,167,59,0.5)",
        "use": "Dashed borders: locked tiles, suggested venue chip"
      },
      "coaster": {
        "value": "#F2E3C6",
        "use": "Category coaster fill"
      },
      "coasterInk": {
        "value": "#3A2413",
        "use": "Coaster label and icon strokes"
      },
      "coasterRing": {
        "value": "#B9702A",
        "use": "Coaster dashed inner ring"
      },
      "toast": {
        "value": "#FFF3DE",
        "use": "Toast background (inverted)"
      },
      "toastInk": {
        "value": "#23160E",
        "use": "Toast text"
      },
      "danger": {
        "value": "#F08A6B",
        "use": "Delete action text"
      },
      "scrim": {
        "value": "rgba(10,5,2,0.55)",
        "use": "Behind bottom sheets"
      }
    },
    "light": {
      "bg": {
        "value": "#FBF4E6"
      },
      "surface": {
        "value": "#FFFCF6"
      },
      "surface2": {
        "value": "#F2E4CB"
      },
      "ink": {
        "value": "#2A1A0F"
      },
      "muted": {
        "value": "#6B503B"
      },
      "accent": {
        "value": "#F4A73B"
      },
      "accentText": {
        "value": "#8F520A",
        "use": "Darkened so accent-as-text passes 4.5:1 on light bg"
      },
      "onAccent": {
        "value": "#24160C"
      },
      "line": {
        "value": "rgba(42,26,15,0.13)"
      },
      "ring": {
        "value": "rgba(143,82,10,0.45)"
      },
      "coaster": {
        "value": "#FFFFFF",
        "use": "Plus 1px rgba(42,26,15,0.16) outline"
      },
      "coasterInk": {
        "value": "#3A2413"
      },
      "coasterRing": {
        "value": "#D48A36"
      },
      "toast": {
        "value": "#2A1A0F"
      },
      "toastInk": {
        "value": "#FBF4E6"
      },
      "danger": {
        "value": "#A63A1F"
      },
      "scrim": {
        "value": "rgba(10,5,2,0.45)"
      }
    },
    "drinkIcon": {
      "stroke": {
        "value": "{color.<mode>.coasterInk} on coasters; currentColor (ink) elsewhere"
      },
      "liquid": {
        "value": "#E9A640"
      },
      "bubble": {
        "value": "Same as the surface the icon sits on (coaster / surface2 / bg)"
      },
      "olive": {
        "value": "#7E8F33"
      },
      "ice": {
        "value": "Surface colour at 55% opacity"
      }
    },
    "members": {
      "$description": "Avatar fills, assigned in join order and stable for the trip. Text on avatars is #1B120B.",
      "palette": [
        "#F4A73B",
        "#8FC1E3",
        "#E88C7D",
        "#A7D17A",
        "#D6A8E6",
        "#E8D27A",
        "#9FD6C8",
        "#F2B4C8",
        "#C9B38A",
        "#B8C4F0"
      ]
    },
    "chartCategory": {
      "beer": "#F4A73B",
      "cocktail": "#E88C7D",
      "wine": "#C9534A",
      "shot": "#FFF3DE",
      "soft": "#7FA35C",
      "spirit": "#D98E3F",
      "cider": "#B7C95A",
      "seltzer": "#9FD6C8",
      "other": "#B39A7A"
    }
  },
  "font": {
    "display": {
      "family": "Alfa Slab One",
      "fallback": "Georgia, serif",
      "weights": [
        400
      ],
      "source": "Google Fonts",
      "use": "Screen titles, big numbers, coaster labels, wizard questions, Wrapped headlines"
    },
    "body": {
      "family": "Instrument Sans",
      "fallback": "system-ui, sans-serif",
      "weights": [
        400,
        500,
        600,
        700
      ],
      "source": "Google Fonts",
      "use": "Everything else"
    },
    "numerals": "Use tabular figures (font-variant-numeric: tabular-nums) for totals, leaderboard values, countdowns, ABV."
  },
  "type": {
    "wrappedHuge": {
      "font": "display",
      "size": 128,
      "lineHeight": 0.9,
      "tracking": -3,
      "use": "Single hero number on a Wrapped card"
    },
    "wrappedLarge": {
      "font": "display",
      "size": 44,
      "lineHeight": 1,
      "tracking": -1,
      "use": "Archetype name, 'ready' headline"
    },
    "wrappedLine": {
      "font": "display",
      "size": 30,
      "lineHeight": 1.1,
      "use": "Wrapped sentences"
    },
    "totalHero": {
      "font": "display",
      "size": 46,
      "lineHeight": 1,
      "tracking": -0.5
    },
    "screenTitle": {
      "font": "display",
      "size": 30,
      "lineHeight": 1.05
    },
    "wizardQuestion": {
      "font": "display",
      "size": 28,
      "lineHeight": 1.1
    },
    "sheetTitle": {
      "font": "display",
      "size": 18
    },
    "sectionTitle": {
      "font": "display",
      "size": 22
    },
    "statNumber": {
      "font": "display",
      "size": 26,
      "use": "Std estimate, stepper value, drink summary name (24, 2-line clamp)"
    },
    "leaderValue": {
      "font": "display",
      "size": 20
    },
    "button": {
      "font": "body",
      "size": 17,
      "weight": 600,
      "use": "Log / primary 18"
    },
    "bodyStrong": {
      "font": "body",
      "size": 16,
      "weight": 600
    },
    "body": {
      "font": "body",
      "size": 15,
      "weight": 400,
      "lineHeight": 1.35
    },
    "chip": {
      "font": "body",
      "size": 14.5,
      "weight": 500
    },
    "caption": {
      "font": "body",
      "size": 13,
      "weight": 400,
      "color": "muted"
    },
    "tabLabel": {
      "font": "body",
      "size": 11.5,
      "weight": 500
    },
    "coasterLabel": {
      "font": "display",
      "size": 14.5,
      "note": "Set on a circular path along the bottom arc of the coaster"
    }
  },
  "space": {
    "screenGutter": 18,
    "safeTop": 46,
    "tabBarBottomPad": 20,
    "stackTight": 6,
    "stack": 10,
    "stackLoose": 16,
    "section": 20,
    "tileGap": 10,
    "coasterGap": {
      "row": 10,
      "column": 16
    }
  },
  "radius": {
    "pill": 999,
    "chip": 999,
    "button": 14,
    "primaryButton": 18,
    "logButton": 20,
    "tile": 18,
    "block": 20,
    "sheet": 28,
    "stepperButton": "50%",
    "avatar": "50%",
    "coaster": "50%",
    "toast": 20,
    "lockedTile": 16,
    "countdown": 14,
    "input": 12,
    "qrCard": 20
  },
  "size": {
    "minTouch": 44,
    "chipHeight": 44,
    "tileMinHeight": 72,
    "againButtonHeight": 58,
    "logButtonHeight": 60,
    "stepperButton": 46,
    "inputHeight": 52,
    "authCoaster": {
      "value": 168,
      "keyboardOpen": 72,
      "compact": 72,
      "use": "Hero coaster on signed-out screens; shrinks while the keyboard is up; compact (top left) on three-field forms"
    },
    "qrCode": 232,
    "avatar": {
      "sm": 30,
      "md": 40
    },
    "coasterGrid": "3 columns, square, fills width minus gutters (~96 px on a 360 pt screen)",
    "icon": {
      "ui": 20,
      "uiSmall": 16,
      "drinkCoaster": "44% of coaster",
      "drinkChip": 20,
      "drinkFeed": 30,
      "drinkSummary": 46,
      "drinkSheetTitle": 24
    }
  },
  "stroke": {
    "uiIcon": 1.8,
    "drinkIcon": 2.3,
    "coasterRing": {
      "width": 1.6,
      "dash": "3 3"
    },
    "input": {
      "rest": 1.5,
      "focus": 2,
      "use": "Text field border. Rest = line, focus = accent, error = danger. Fill = surface on bg, bg on surface."
    }
  },
  "elevation": {
    "coaster": "0 2px 0 rgba(0,0,0,0.25)",
    "toast": "0 12px 30px rgba(0,0,0,0.35)"
  },
  "motion": {
    "sheetOpen": {
      "duration": 300,
      "easing": "cubic-bezier(.2,.85,.25,1)",
      "property": "translateY 105% to 0"
    },
    "scrim": {
      "duration": 220,
      "property": "opacity"
    },
    "wizardStep": {
      "duration": 220,
      "easing": "ease-out",
      "property": "opacity 0 to 1, translateX 22px to 0",
      "trigger": "Only on step change, not on re-render"
    },
    "toast": {
      "duration": 250,
      "property": "opacity, translateY 16px to 0",
      "autoDismiss": 6500
    },
    "achievement": {
      "duration": 350,
      "easing": "cubic-bezier(.2,.9,.3,1.2)",
      "property": "translateY -130% to 0 plus opacity",
      "delayAfterLog": 700,
      "autoDismiss": 4200
    },
    "coasterPress": {
      "duration": 120,
      "property": "scale 0.93 while pressed"
    },
    "reducedMotion": "Disable wizard slide, sheet slide and toast slide; keep opacity changes only (or instant)."
  },
  "haptics": {
    "log": "Light impact (~12 ms) on every successful log, edit, delete, rating",
    "achievement": "Light impact when the achievement banner appears"
  }
} as const;

export const color = tokens['color'];
export const font = tokens.font;
export const type = tokens.type;
export const space = tokens.space;
export const radius = tokens.radius;
export const size = tokens.size;
export const stroke = tokens.stroke;
export const elevation = tokens.elevation;
export const motion = tokens.motion;
export const haptics = tokens.haptics;
export const tabular = { fontVariantNumeric: 'tabular-nums' } as const;
