# Test selfies

Only photos taken **with the person's written consent** for testing this app. Don't commit them to a public repo.

For the Phase 2 checks, add at least 3 different skin tones, plus one too-dark and one blurry photo:

```
person1.jpg   person2.jpg   person3.jpg   too-dark.jpg   blurry.jpg
```

Resize to ~1024px on the long side (JPEG, quality ~0.8) and run:

```bash
cd worker
API=http://localhost:8787 CODE=<invite> node scripts/check-analyze.mjs ../fixtures/selfies/person1.jpg
```
