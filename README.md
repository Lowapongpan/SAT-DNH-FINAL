# D&H SAT Practice Online

This version keeps the original Firebase + GitHub Pages setup, but adds the preloaded SAT library and detailed attempt review.

## What changed in this version

- Added the folder `preloaded/April 4 - May 24 SATs/`.
- Added preloaded standardized SAT PDFs and matching CSV answer files.
- Added a `manifest.json` and JSON data files so the website can load those SATs automatically.
- Students can review mistakes after submitting a test.
- Admins can open a student's attempt and see question-by-question results.
- Attempt documents now save detailed question results, selected answers, correct answers, and module-level analysis.
- Your existing Firebase project still works. You do not need to delete it or create a new one.

## Important Firebase note

Do not create a new Firebase project. Keep using your current Firebase project and your current `firebase-config.js` values.

If your current live website already has a real Firebase config, copy that same config into the new `firebase-config.js` before uploading to GitHub.

## Update your existing GitHub website

1. Download and unzip this package.
2. Open the unzipped folder.
3. Copy your real Firebase config into `firebase-config.js` if it is not already there.
4. Go to your existing GitHub repository.
5. Click **Add file > Upload files**.
6. Drag the contents of the unzipped folder into GitHub.
7. When GitHub asks to replace files with the same names, allow it.
8. Commit directly to the `main` branch.
9. Wait for the GitHub Actions deployment to finish.
10. Hard refresh the website.

You are only updating GitHub code and static assets. Your Firebase Authentication, Firestore, and Storage project stay the same.

## Files/folders that must be replaced or added

Replace these files:

```text
index.html
app.js
styles.css
README.md
firestore.rules
storage.rules
firebase-config.js only if you still need to add your real Firebase config
```

Add/replace these folders:

```text
.github/
templates/
vendor/
preloaded/
```

The new preloaded SATs are inside:

```text
preloaded/April 4 - May 24 SATs/
```

## Firebase rules

Your existing rules should still work. If you want to republish the included rules, paste:

```text
firestore.rules
```

into:

```text
Firebase Console > Firestore Database > Rules
```

and paste:

```text
storage.rules
```

into:

```text
Firebase Console > Storage > Rules
```

Do not paste these into Realtime Database.

## Testing checklist

After GitHub Pages redeploys:

1. Open the live website.
2. Log in as admin.
3. Confirm preloaded tests appear under **Available SATs** and **Saved Tests**.
4. Open a preloaded PDF from a test card.
5. Start a preloaded SAT as a student.
6. Submit the test.
7. Confirm the score report shows mistake review.
8. Log in as admin.
9. Go to **Scores**.
10. Click **Review** beside the attempt.
11. Confirm you can see module analysis and wrong answers.

## Notes

Some preloaded PDFs came from scanned/image-based originals. They were standardized and OCR-cleaned before being added. Review individual questions if something looks wrong.
