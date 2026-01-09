import { Router } from 'express';
// Graph routes - returns 501 until data-plane graph queries are implemented
const router = Router();

router.post('/getFollowers', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getFollows', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getRelationships', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getBlocks', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getMutes', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as graphRoutes };
