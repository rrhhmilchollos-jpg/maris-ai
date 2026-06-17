/**
 * DOMINO Chain - Sistema Social y Referrals
 * Compartir, invitar amigos y bonificaciones por referrals
 */

import React, { useState } from 'react';
import { Share2, Users, Gift, Link2, Copy, Check, Twitter, Facebook, MessageCircle } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export interface ReferralLink {
  code: string;
  url: string;
  createdAt: Date;
  clicks: number;
  conversions: number;
  earnings: number;
}

export interface ReferralReward {
  id: string;
  type: 'sign-up' | 'first-gift' | 'milestone' | 'level-up';
  description: string;
  reward: {
    xp: number;
    coins: number;
  };
  icon: string;
}

export interface ShareContent {
  title: string;
  description: string;
  image?: string;
  url: string;
  hashtags: string[];
}

// ============================================================================
// CONSTANTES
// ============================================================================

export const REFERRAL_REWARDS: ReferralReward[] = [
  {
    id: 'sign-up',
    type: 'sign-up',
    description: 'Tu amigo se registra',
    reward: { xp: 500, coins: 250 },
    icon: '🎉',
  },
  {
    id: 'first-gift',
    type: 'first-gift',
    description: 'Tu amigo envía su primer regalo',
    reward: { xp: 1000, coins: 500 },
    icon: '🎁',
  },
  {
    id: 'milestone',
    type: 'milestone',
    description: 'Tu amigo alcanza nivel 10',
    reward: { xp: 2000, coins: 1000 },
    icon: '🏆',
  },
  {
    id: 'level-up',
    type: 'level-up',
    description: 'Tu amigo alcanza nivel 50',
    reward: { xp: 5000, coins: 2500 },
    icon: '👑',
  },
];

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Panel de Referral Link
 */
export const ReferralLinkPanel: React.FC<{
  referralLink: ReferralLink;
  onCopy?: () => void;
}> = ({ referralLink, onCopy }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink.url);
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Link2 size={20} />
        Tu Link de Referral
      </h3>

      {/* Link */}
      <div className="bg-gray-800 rounded-lg p-4 mb-4">
        <p className="text-xs text-gray-400 mb-2">Tu código único:</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={referralLink.code}
            readOnly
            className="flex-1 bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 text-sm font-mono"
          />
          <button
            onClick={handleCopy}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded transition flex items-center gap-2"
          >
            {copied ? (
              <>
                <Check size={16} />
                Copiado
              </>
            ) : (
              <>
                <Copy size={16} />
                Copiar
              </>
            )}
          </button>
        </div>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-800 rounded p-3 text-center">
          <p className="text-xs text-gray-400">Clics</p>
          <p className="text-2xl font-bold text-white">{referralLink.clicks}</p>
        </div>
        <div className="bg-gray-800 rounded p-3 text-center">
          <p className="text-xs text-gray-400">Conversiones</p>
          <p className="text-2xl font-bold text-white">{referralLink.conversions}</p>
        </div>
        <div className="bg-gray-800 rounded p-3 text-center">
          <p className="text-xs text-gray-400">Ganancias</p>
          <p className="text-2xl font-bold text-yellow-400">€{referralLink.earnings.toFixed(2)}</p>
        </div>
      </div>

      {/* Info */}
      <div className="bg-purple-900 bg-opacity-30 rounded p-3">
        <p className="text-xs text-purple-200">
          💡 Comparte tu link y gana recompensas cuando tus amigos se registren y usen la app
        </p>
      </div>
    </div>
  );
};

/**
 * Panel de Recompensas de Referral
 */
export const ReferralRewardsPanel: React.FC<{
  rewards?: ReferralReward[];
  earnedRewards?: string[];
}> = ({ rewards = REFERRAL_REWARDS, earnedRewards = [] }) => {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Gift size={20} />
        Recompensas por Referral
      </h3>

      <div className="space-y-3">
        {rewards.map((reward) => {
          const isEarned = earnedRewards.includes(reward.id);
          return (
            <div
              key={reward.id}
              className={`p-4 rounded-lg border-l-4 transition ${
                isEarned
                  ? 'bg-gradient-to-r from-green-900 to-green-800 border-green-500'
                  : 'bg-gray-800 border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-2xl">{reward.icon}</span>
                  <div>
                    <p className={`font-semibold ${isEarned ? 'text-green-300' : 'text-white'}`}>
                      {reward.description}
                    </p>
                    {isEarned && (
                      <p className="text-xs text-green-200">✓ Completado</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-purple-400">+{reward.reward.xp} XP</p>
                  <p className="text-sm font-bold text-yellow-400">+{reward.reward.coins} €</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Botones de Compartir Social
 */
export const SocialShareButtons: React.FC<{
  content: ShareContent;
  onShare?: (platform: string) => void;
}> = ({ content, onShare }) => {
  const handleShare = (platform: string) => {
    const text = `${content.title} - ${content.description} ${content.hashtags.join(' ')}`;
    const url = content.url;

    let shareUrl = '';
    switch (platform) {
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
        break;
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
        break;
      case 'whatsapp':
        shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
        break;
      case 'telegram':
        shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
        break;
    }

    if (shareUrl) {
      window.open(shareUrl, '_blank', 'width=600,height=400');
      onShare?.(platform);
    }
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Share2 size={20} />
        Compartir en Redes Sociales
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => handleShare('twitter')}
          className="bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
        >
          <Twitter size={18} />
          <span className="hidden sm:inline">Twitter</span>
        </button>
        <button
          onClick={() => handleShare('facebook')}
          className="bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
        >
          <Facebook size={18} />
          <span className="hidden sm:inline">Facebook</span>
        </button>
        <button
          onClick={() => handleShare('whatsapp')}
          className="bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
        >
          <MessageCircle size={18} />
          <span className="hidden sm:inline">WhatsApp</span>
        </button>
        <button
          onClick={() => handleShare('telegram')}
          className="bg-gradient-to-br from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
        >
          <MessageCircle size={18} />
          <span className="hidden sm:inline">Telegram</span>
        </button>
      </div>

      {/* Preview */}
      <div className="mt-4 bg-gray-800 rounded-lg p-4">
        <p className="text-xs text-gray-400 mb-2">Vista previa:</p>
        <p className="text-white font-semibold">{content.title}</p>
        <p className="text-sm text-gray-300 mt-1">{content.description}</p>
        <p className="text-xs text-purple-400 mt-2">{content.hashtags.join(' ')}</p>
      </div>
    </div>
  );
};

/**
 * Panel de Invitar Amigos
 */
export const InviteFriendsPanel: React.FC<{
  referralLink: ReferralLink;
  onInvite?: () => void;
}> = ({ referralLink, onInvite }) => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSendInvite = () => {
    if (email) {
      // Simulación de envío
      setSent(true);
      onInvite?.();
      setTimeout(() => {
        setSent(false);
        setEmail('');
      }, 2000);
    }
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Users size={20} />
        Invitar Amigos
      </h3>

      <div className="space-y-3">
        <input
          type="email"
          placeholder="Email del amigo"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-gray-800 text-white px-4 py-2 rounded border border-gray-600 focus:border-purple-600 outline-none transition"
        />
        <button
          onClick={handleSendInvite}
          disabled={!email || sent}
          className={`w-full py-2 rounded-lg font-semibold transition ${
            sent
              ? 'bg-green-600 text-white'
              : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white'
          }`}
        >
          {sent ? '✓ Invitación enviada' : 'Enviar invitación'}
        </button>
      </div>

      {/* Info */}
      <div className="mt-4 bg-purple-900 bg-opacity-30 rounded p-3">
        <p className="text-xs text-purple-200">
          📧 Envía invitaciones personalizadas a tus amigos y ambos recibirán bonificaciones
        </p>
      </div>
    </div>
  );
};

/**
 * Panel Completo de Social
 */
export const SocialSystemPanel: React.FC<{
  referralLink: ReferralLink;
  shareContent: ShareContent;
  earnedRewards?: string[];
  onShare?: (platform: string) => void;
  onInvite?: () => void;
  onCopyLink?: () => void;
}> = ({
  referralLink,
  shareContent,
  earnedRewards = [],
  onShare,
  onInvite,
  onCopyLink,
}) => {
  return (
    <div className="space-y-6">
      {/* Link de Referral */}
      <ReferralLinkPanel referralLink={referralLink} onCopy={onCopyLink} />

      {/* Compartir en Redes */}
      <SocialShareButtons content={shareContent} onShare={onShare} />

      {/* Invitar Amigos */}
      <InviteFriendsPanel referralLink={referralLink} onInvite={onInvite} />

      {/* Recompensas */}
      <ReferralRewardsPanel earnedRewards={earnedRewards} />
    </div>
  );
};

/**
 * Generador de datos de ejemplo
 */
export function generateMockReferralLink(): ReferralLink {
  return {
    code: 'CRISTAL2026',
    url: 'https://domino.app?ref=CRISTAL2026',
    createdAt: new Date('2026-01-15'),
    clicks: 234,
    conversions: 18,
    earnings: 450.5,
  };
}

export function generateMockShareContent(): ShareContent {
  return {
    title: '🎮 ¡Únete a DOMINO - La App del Verano 2026!',
    description: 'Envía regalos épicos, compite con amigos y gana dinero real. ¡Descárgalo ahora!',
    url: 'https://domino.app',
    hashtags: ['#DOMINO2026', '#AppDelVerano', '#Regalos', '#Gaming', '#Viral'],
  };
}

export default {
  REFERRAL_REWARDS,
  ReferralLinkPanel,
  ReferralRewardsPanel,
  SocialShareButtons,
  InviteFriendsPanel,
  SocialSystemPanel,
  generateMockReferralLink,
  generateMockShareContent,
};
