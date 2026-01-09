import { Router } from 'express';
// Notification routes - returns 501 until data-plane notifications are implemented
const router = Router();

router.post('/listNotifications', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/getUnreadCount', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export { router as notificationRoutes };
