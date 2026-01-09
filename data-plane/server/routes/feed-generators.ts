import { Router } from 'express';
// Feed generator routes - returns 501 until data-plane feed generators are implemented
const router = Router();

router.post('/getFeedGenerators', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getFeedGenerator', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as feedGeneratorRoutes };
