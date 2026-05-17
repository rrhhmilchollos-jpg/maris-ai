import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { Ticket, User } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Endpoint para que los usuarios creen un nuevo ticket
router.post("/tickets", requireAuth, async (req, res) => {
  await connectDB();
  const { subject, message } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!subject || !message) {
    return res.status(400).json({ error: "Asunto y mensaje son obligatorios" });
  }

  try {
    const newTicket = await Ticket.create({
      userId,
      subject,
      message,
      status: "open",
      responses: [],
    });
    res.status(201).json(newTicket);
  } catch (error) {
    logger.error({ error }, "Error al crear ticket");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para que los usuarios vean sus propios tickets
router.get("/tickets", requireAuth, async (req, res) => {
  await connectDB();
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    const tickets = await Ticket.find({ userId }).sort({ createdAt: -1 }).lean();
    res.json(tickets);
  } catch (error) {
    logger.error({ error }, "Error al obtener tickets del usuario");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoints de administración para tickets
router.use("/admin/tickets", requireAuth, requireAdmin);

// Endpoint para que los administradores vean todos los tickets
router.get("/admin/tickets", async (_req, res) => {
  await connectDB();
  try {
    const tickets = await Ticket.find({}).sort({ createdAt: -1 }).lean();
    const userIds = [...new Set(tickets.map((t) => t.userId))];
    const users = await User.find({ _id: { $in: userIds } }, { email: 1 }).lean();
    const emailMap = new Map(users.map((u) => [String(u._id), u.email]));

    res.json(
      tickets.map((t) => ({
        ...t,
        userEmail: emailMap.get(t.userId) ?? "(usuario eliminado)",
      })),
    );
  } catch (error) {
    logger.error({ error }, "Error al obtener todos los tickets para admin");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para que los administradores respondan a un ticket
router.post("/admin/tickets/:id/respond", async (req, res) => {
  await connectDB();
  const ticketId = req.params.id;
  const { message, newStatus } = req.body;
  const adminId = req.user?.id;

  if (!adminId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!message) {
    return res.status(400).json({ error: "El mensaje de respuesta es obligatorio" });
  }

  try {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }

    ticket.responses.push({
      senderId: adminId,
      message,
      createdAt: new Date(),
    });
    if (newStatus) {
      ticket.status = newStatus; // Permite al admin cambiar el estado del ticket
    }
    await ticket.save();

    res.json(ticket);
  } catch (error) {
    logger.error({ error }, "Error al responder ticket");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para que los administradores cambien el estado de un ticket
router.post("/admin/tickets/:id/status", async (req, res) => {
  await connectDB();
  const ticketId = req.params.id;
  const { status } = req.body;

  if (!status || !['open', 'in_progress', 'closed'].includes(status)) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  try {
    const ticket = await Ticket.findByIdAndUpdate(
      ticketId,
      { $set: { status } },
      { new: true }
    );
    if (!ticket) {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }
    res.json(ticket);
  } catch (error) {
    logger.error({ error }, "Error al cambiar el estado del ticket");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
