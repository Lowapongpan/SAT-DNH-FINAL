# Upload Templates

Use these files when preparing SAT uploads.

## Answer Sheet

Best format:

```csv
module,question,answer,notes
RW1,1,A,
RW1,2,C,
RW2,1,B,
MATH1,1,D,
MATH1,2,A,
MATH2,1,B,
```

Allowed module names:

- `RW1`
- `RW2`
- `MATH1`
- `MATH2`

All questions in this version are multiple choice. Use only `A`, `B`, `C`, or `D`.

## Grading System

Use `grading-system-template.csv` when you have an official raw-to-scale table.

Format:

```csv
section,raw,score
rw,0,200
rw,1,210
math,0,200
math,1,210
```

Allowed sections:

- `rw` for Reading and Writing
- `math` for Math

The website uses the uploaded grading table for that test. If no grading table is uploaded, it falls back to a simple SAT-style 200-800 section estimate.
