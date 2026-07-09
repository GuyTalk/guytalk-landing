'use strict';

/**
 * GuyTalk — reader reviews API
 *
 * Accepts review submissions (name, email, rating 1-5, text)
 * Stores in brief/data/reviews.json
 * Returns success/failure
 */

const fs = require('fs');
const path = require('path');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REVIEWS_FILE = path.join(__dirname, '..', 'brief', 'data', 'reviews.json');

function loadReviews() {
  try {
    if (fs.existsSync(REVIEWS_FILE)) {
      const data = fs.readFileSync(REVIEWS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading reviews:', e);
  }
  return { approved: [], pending: [] };
}

function saveReviews(data) {
  try {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving reviews:', e);
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const reviews = loadReviews();
    return res.status(200).json({ ok: true, reviews: reviews.approved });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const email = (body?.email || '').trim().toLowerCase();
  const name = (body?.name || '').trim();
  const rating = parseInt(body?.rating, 10);
  const text = (body?.review || '').trim();

  // Validate inputs
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }
  if (!name || name.length < 2) {
    return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  }
  if (isNaN(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: 'Rating must be between 1 and 5.' });
  }
  if (!text || text.length < 10) {
    return res.status(400).json({ ok: false, error: 'Please write at least 10 characters.' });
  }

  // Create review object
  const review = {
    id: Date.now().toString(),
    name,
    email,
    rating,
    text,
    submitted: new Date().toISOString(),
    approved: false,
  };

  // Save review to pending queue
  const reviews = loadReviews();
  reviews.pending = reviews.pending || [];
  reviews.pending.push(review);

  if (!saveReviews(reviews)) {
    return res.status(500).json({ ok: false, error: 'Could not save review. Please try again.' });
  }

  // Send confirmation email to user
  try {
    const Resend = require('resend').default || require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'GuyTalk <noreply@resend.dev>',
      to: email,
      subject: '✓ Thanks for the review',
      html: `
        <p>Hey ${name},</p>
        <p>Thanks for taking the time to share your thoughts on GuyTalk. We read every review and really appreciate the feedback.</p>
        <p>Your review (${rating}★) will be featured on our reviews page soon.</p>
        <p>Keep sharp,<br/>The GuyTalk Team</p>
      `,
    });
  } catch (e) {
    console.error('Error sending confirmation email:', e);
  }

  return res.status(200).json({
    ok: true,
    message: 'Thanks for the review! We\'ll feature it on our page soon.',
    review: { name, rating },
  });
};
