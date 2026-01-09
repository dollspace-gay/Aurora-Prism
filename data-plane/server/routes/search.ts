import { Router } from 'express';
// Search routes - returns 501 until data-plane search is implemented
const router = Router();

router.post('/searchPosts', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as searchRoutes };
