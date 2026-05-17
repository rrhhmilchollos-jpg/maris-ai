import React, { useState, useEffect } from "react";
import { Cloud, RotateCw, AlertCircle, CheckCircle, Loader } from "lucide-react";

interface DeploymentButtonsProps {
  appId: string;
  onDeploymentSuccess?: (url: string) => void;
  userPlan?: "free" | "pro" | "enterprise";
}

interface DeploymentStatus {
  status: "not_deployed" | "deploying" | "deployed" | "failed";
  deploymentUrl?: string;
  subdomain?: string;
  customDomain?: string;
  customDomainVerified?: boolean;
  lastDeployedAt?: string;
  error?: string;
}

export function DeploymentButtons({ appId, onDeploymentSuccess, userPlan = "free" }: DeploymentButtonsProps) {
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showCustomDomainModal, setShowCustomDomainModal] = useState(false);
  const [customDomain, setCustomDomain] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // Fetch deployment status on mount
  useEffect(() => {
    fetchDeploymentStatus();
    const interval = setInterval(fetchDeploymentStatus, 5000);
    return () => clearInterval(interval);
  }, [appId]);

  const fetchDeploymentStatus = async () => {
    try {
      const response = await fetch(`/api/apps/${appId}/deployment-status`);
      if (response.ok) {
        const data = (await response.json()) as DeploymentStatus;
        setDeploymentStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch deployment status:", error);
    }
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      const response = await fetch(`/api/apps/${appId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customDomain: userPlan !== "free" ? customDomain : undefined }),
      });

      if (response.ok) {
        const data = (await response.json()) as { deploymentUrl: string; subdomain?: string };
        setDeploymentStatus({
          status: "deployed",
          deploymentUrl: data.deploymentUrl,
          subdomain: data.subdomain,
        });
        onDeploymentSuccess?.(data.deploymentUrl);
      } else {
        const error = (await response.json()) as { error: string };
        setDeploymentStatus({
          status: "failed",
          error: error.error,
        });
      }
    } catch (error) {
      setDeploymentStatus({
        status: "failed",
        error: error instanceof Error ? error.message : "Deployment failed",
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleRedeploy = async () => {
    setIsDeploying(true);
    try {
      const response = await fetch(`/api/apps/${appId}/redeploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (response.ok) {
        const data = (await response.json()) as { deploymentUrl: string };
        setDeploymentStatus({
          status: "deployed",
          deploymentUrl: data.deploymentUrl,
          subdomain: deploymentStatus?.subdomain,
        });
        onDeploymentSuccess?.(data.deploymentUrl);
      } else {
        const error = (await response.json()) as { error: string };
        setDeploymentStatus({
          status: "failed",
          error: error.error,
        });
      }
    } catch (error) {
      setDeploymentStatus({
        status: "failed",
        error: error instanceof Error ? error.message : "Redeployment failed",
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleAddCustomDomain = async () => {
    if (!customDomain) return;

    setIsVerifying(true);
    try {
      const response = await fetch(`/api/apps/${appId}/custom-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: customDomain }),
      });

      if (response.ok) {
        const data = (await response.json()) as { customDomain: string; verified: boolean };
        setDeploymentStatus((prev) => ({
          ...(prev || { status: "deployed" as const }),
          status: (prev?.status || "deployed") as "deployed" | "not_deployed" | "deploying" | "failed",
          customDomain: data.customDomain,
          customDomainVerified: data.verified,
        }));
        setShowCustomDomainModal(false);
        setCustomDomain("");
      } else {
        const error = (await response.json()) as { error: string };
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : "Failed to add custom domain"}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const isDeployed = deploymentStatus?.status === "deployed";
  const isFailed = deploymentStatus?.status === "failed";
  const isDeploying_state = deploymentStatus?.status === "deploying" || isDeploying;

  return (
    <div className="space-y-4">
      {/* Deployment Status */}
      {deploymentStatus && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            {isDeploying_state && <Loader className="h-5 w-5 animate-spin text-blue-500" />}
            {isDeployed && <CheckCircle className="h-5 w-5 text-green-500" />}
            {isFailed && <AlertCircle className="h-5 w-5 text-red-500" />}

            <div className="flex-1">
              <p className="font-medium text-slate-900">
                {isDeploying_state && "Deploying..."}
                {isDeployed && "Deployment Successful"}
                {isFailed && "Deployment Failed"}
              </p>

              {deploymentStatus.deploymentUrl && (
                <p className="text-sm text-slate-600">
                  URL:{" "}
                  <a
                    href={deploymentStatus.deploymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {deploymentStatus.deploymentUrl}
                  </a>
                </p>
              )}

              {deploymentStatus.subdomain && userPlan === "free" && (
                <p className="text-sm text-slate-600">
                  Subdomain: <code className="rounded bg-slate-200 px-2 py-1">{deploymentStatus.subdomain}.maris-ai.com</code>
                </p>
              )}

              {deploymentStatus.error && (
                <p className="text-sm text-red-600">{deploymentStatus.error}</p>
              )}

              {deploymentStatus.lastDeployedAt && (
                <p className="text-xs text-slate-500">
                  Last deployed: {new Date(deploymentStatus.lastDeployedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deployment Buttons */}
      <div className="flex gap-3">
        {!isDeployed ? (
          <button
            onClick={handleDeploy}
            disabled={isDeploying}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Cloud className="h-4 w-4" />
            {isDeploying ? "Deploying..." : "Deploy"}
          </button>
        ) : (
          <button
            onClick={handleRedeploy}
            disabled={isDeploying}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
          >
            <RotateCw className="h-4 w-4" />
            {isDeploying ? "Re-deploying..." : "Re-deploy"}
          </button>
        )}

        {/* Custom Domain Button (Paid Users Only) */}
        {userPlan !== "free" && isDeployed && (
          <button
            onClick={() => setShowCustomDomainModal(true)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
          >
            {deploymentStatus?.customDomainVerified ? "Update Domain" : "Add Custom Domain"}
          </button>
        )}

        {/* Free Plan Info */}
        {userPlan === "free" && isDeployed && (
          <div className="flex items-center rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <AlertCircle className="mr-2 h-4 w-4" />
            Upgrade to Pro to use custom domains
          </div>
        )}
      </div>

      {/* Custom Domain Modal */}
      {showCustomDomainModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold">Add Custom Domain</h3>

            <input
              type="text"
              placeholder="example.com"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2"
            />

            <p className="mb-4 text-sm text-slate-600">
              Make sure your DNS records point to our servers. We'll verify automatically.
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleAddCustomDomain}
                disabled={isVerifying || !customDomain}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isVerifying ? "Verifying..." : "Add Domain"}
              </button>
              <button
                onClick={() => setShowCustomDomainModal(false)}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
