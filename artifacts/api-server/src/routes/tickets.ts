import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, requireAdmin, isAdminEmail } from "../lib/auth";
import { Ticket, User, type ITicket, type IUser } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { sendSupportTicketCreatedEmail } from "../lib/notify";
import { refundCredits } from "../lib/credits";

const router: IRouter = Router();

// Endpoint para que los usuarios creen un nuevo ticket
router.post("/tickets", requireAuth, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { subject, message, category, refundRequest } = req.body;
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!subject || !message) {
    return res.status(400).json({ error: "Asunto y mensaje son obligatorios" });
  }
  const allowedCategories = ["general", "account_deletion", "refund"];
  const safeCategory = allowedCategories.includes(category) ? category : "general";

  try {
    const newTicket = await Ticket.create({
      userId,
      subject,
      message,
      status: "open",
      category: safeCategory,
      ...(safeCategory === "refund" && refundRequest?.amountText
        ? { refundRequest: { amountText: String(refundRequest.amountText).slice(0, 500) } }
        : {}),
      responses: [],
    });
    const ticketId = String(newTicket._id);
    const user = await User.findById(userId, { email: 1, credits: 1 }).lean().catch(() => null) as any;

    // ── MarisCrewAI + Autopilot: resuelve el ticket automáticamente ──
    // IMPORTANTE: los tickets de baja de cuenta y reembolso NUNCA se
    // auto-resuelven por IA. Siempre requieren aprobación manual de un
    // administrador humano desde el panel de soporte.
    let aiResolved = false;
    if (safeCategory === "general") {
    try {
      const { MarisSuportCrew } = await import("../lib/marisCrewAI");
      const crew = new MarisSuportCrew();
      const crewResult = await crew.handleTicket({ userId, userEmail: user?.email || "", subject, message });
      if (crewResult.resolved && crewResult.reply) {
        await Ticket.findByIdAndUpdate(ticketId, {
          $set: { status: "resolved" },
          $push: { responses: { role: "assistant", content: `🤖 ${crewResult.reply}`, createdAt: new Date() } },
        });
        aiResolved = true;
        logger.info({ ticketId }, "Ticket resuelto por MarisCrewAI");
      }
    } catch (crewErr) {
      logger.warn({ crewErr }, "CrewAI failed, fallback to Autopilot");
      try {
        const { handleSupportTicketWithAI } = await import("../lib/aiAutopilot");
        const result = await handleSupportTicketWithAI({ userEmail: user?.email || "", userId, subject, message, ticketId });
        if (result.resolved) {
          await Ticket.findByIdAndUpdate(ticketId, {
            $set: { status: "resolved" },
            $push: { responses: { role: "assistant", content: `🤖 ${result.reply}`, createdAt: new Date() } },
          });
          aiResolved = true;
        }
      } catch { /* no bloquear */ }
    }
    }

    // Solo notificar a Ivan si la IA no pudo resolverlo
    if (!aiResolved) {
      void sendSupportTicketCreatedEmail({
        to: process.env.SUPPORT_EMAIL || "rrhh.milchollos@gmail.com",
        userEmail: user?.email ?? null,
        subject,
        message,
        ticketId,
        log: logger,
      });
    }
    res.status(201).json({ ...newTicket.toObject(), aiResolved });
  } catch (error) {
    logger.error({ error }, "Error al crear ticket");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para que los usuarios vean sus propios tickets
router.get("/tickets", requireAuth, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const userId = req.userId;

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

// Endpoint para que los usuarios respondan a sus propios tickets
router.post("/tickets/:id/respond", requireAuth, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const ticketId = req.params.id;
  const { message } = req.body;
  const userId = req.userId;

  if (!userId) {
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
    if (ticket.userId !== userId) {
      return res.status(403).json({ error: "No tienes permiso para responder a este ticket" });
    }

    ticket.responses.push({
      senderId: userId,
      message,
      createdAt: new Date(),
    });
    // Si el ticket estaba abierto, cambiarlo a en progreso cuando el usuario responde
    if (ticket.status === 'open') {
      ticket.status = 'in_progress';
    }
    await ticket.save();

    res.json(ticket);
  } catch (error) {
    logger.error({ error }, "Error al responder ticket de usuario");
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
router.post("/admin/tickets/:id/respond", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const ticketId = req.params.id;
  const { message, newStatus } = req.body;
  const adminId = req.userId;

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
router.post("/admin/tickets/:id/status", async (req: any, res: any): Promise<void> => {
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

// ── Aprobar baja de cuenta (suspende el acceso; requiere acción manual del admin) ──
// No borra datos de forma permanente. Reutiliza el mismo mecanismo de
// suspensión ya usado en /admin/users/:id/suspend, para que sea reversible
// si el cliente cambia de opinión antes de un borrado definitivo.
router.post("/admin/tickets/:id/approve-deletion", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const ticketId = req.params.id;
  const { note } = req.body;
  const adminId = req.userId;

  try {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
    if (ticket.category !== "account_deletion") {
      res.status(400).json({ error: "Este ticket no es una solicitud de baja de cuenta" });
      return;
    }

    await User.findByIdAndUpdate(ticket.userId, {
      isSuspended: true,
      suspendedAt: new Date(),
      suspendReason: `Baja de cuenta aprobada por soporte (ticket ${ticketId})`,
    });

    ticket.status = "closed";
    ticket.resolution = { action: "approved", byAdminId: adminId, at: new Date(), note };
    ticket.responses.push({
      senderId: adminId,
      message: note || "Tu solicitud de baja ha sido aprobada. Tu cuenta ha sido desactivada.",
      createdAt: new Date(),
    });
    await ticket.save();

    res.json({ ok: true, ticket });
  } catch (err) {
    logger.error({ err, ticketId }, "Error al aprobar baja de cuenta");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── Aprobar reembolso ──
// Por defecto reembolsa en créditos internos (reversible, funciona con
// cualquier proveedor de pago). Si se indica stripeChargeId Y el pago fue
// hecho con Stripe (legado, previo a la migración a Viva), también intenta
// el reembolso real a la tarjeta vía Stripe.
router.post("/admin/tickets/:id/approve-refund", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const ticketId = req.params.id;
  const { creditsAmount, note, stripeSessionId, stripeAmountCents } = req.body;
  const adminId = req.userId;

  try {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }
    if (ticket.category !== "refund") {
      res.status(400).json({ error: "Este ticket no es una solicitud de reembolso" });
      return;
    }

    let creditsResult: { newBalance?: number } = {};
    if (creditsAmount && Number(creditsAmount) > 0) {
      const targetUser = await User.findById(ticket.userId).lean();
      if (!targetUser) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
      await refundCredits({
        userId: ticket.userId,
        isAdmin: isAdminEmail(targetUser.email),
        amount: Number(creditsAmount),
        description: note || `Reembolso aprobado desde ticket ${ticketId}`,
        supportTicketId: String(ticket._id),
        approvedBy: String(adminId),
      });
      const updated = await User.findById(ticket.userId).select("credits").lean();
      creditsResult = { newBalance: (updated as any)?.credits ?? null };
    }

    let stripeResult: any = null;
    if (stripeSessionId) {
      try {
        const { getStripe } = await import("../lib/payments");
        const stripe = await getStripe();
        if (stripe) {
          const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
          const paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
          if (paymentIntentId) {
            const refundParams: any = { payment_intent: paymentIntentId, reason: "requested_by_customer" };
            if (stripeAmountCents && stripeAmountCents > 0) refundParams.amount = stripeAmountCents;
            stripeResult = await stripe.refunds.create(refundParams);
          }
        }
      } catch (stripeErr) {
        logger.error({ stripeErr, ticketId }, "Error al reembolsar vía Stripe (legado) desde ticket");
        // No bloquear el resto del flujo si esto falla; el admin lo verá en la respuesta.
      }
    }

    ticket.status = "closed";
    ticket.resolution = { action: "approved", byAdminId: adminId, at: new Date(), note };
    ticket.responses.push({
      senderId: adminId,
      message: note || "Tu solicitud de reembolso ha sido aprobada.",
      createdAt: new Date(),
    });
    await ticket.save();

    res.json({ ok: true, ticket, creditsResult, stripeResult });
  } catch (err) {
    logger.error({ err, ticketId }, "Error al aprobar reembolso");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── Denegar solicitud (baja o reembolso) ──
router.post("/admin/tickets/:id/deny", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const ticketId = req.params.id;
  const { note } = req.body;
  const adminId = req.userId;

  if (!note || !String(note).trim()) {
    res.status(400).json({ error: "Debes indicar el motivo de la denegación" });
    return;
  }

  try {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) { res.status(404).json({ error: "Ticket no encontrado" }); return; }

    ticket.status = "closed";
    ticket.resolution = { action: "denied", byAdminId: adminId, at: new Date(), note };
    ticket.responses.push({ senderId: adminId, message: note, createdAt: new Date() });
    await ticket.save();

    res.json({ ok: true, ticket });
  } catch (err) {
    logger.error({ err, ticketId }, "Error al denegar solicitud");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
