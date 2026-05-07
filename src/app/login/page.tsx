"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  Mail,
  ArrowRight,
  Zap,
  ShieldCheck,
  Globe,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const result = await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left Side: Branding & Features */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-zinc-900 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-brand-500 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-500 rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl">
              R
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Rankmaps</h1>
          </div>

          <div className="space-y-12 max-w-md">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-4"
            >
              <h2 className="text-4xl font-bold leading-tight">
                Master your local presence with AI.
              </h2>
              <p className="text-zinc-400 text-lg font-light">
                Automate your Google Business Profile, generate high-converting
                posts, and manage reviews effortlessly.
              </p>
            </motion.div>

            <div className="space-y-6">
              {[
                {
                  icon: Zap,
                  title: "AI Post Generation",
                  desc: "Create engaging posts in seconds.",
                },
                {
                  icon: ShieldCheck,
                  title: "Review Management",
                  desc: "Automated responses that sound human.",
                },
                {
                  icon: Globe,
                  title: "Local SEO Insights",
                  desc: "Track your rankings and visibility.",
                },
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.1 }}
                  className="flex gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                    <feature.icon className="text-brand-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{feature.title}</h3>
                    <p className="text-zinc-500">{feature.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative z-10 text-zinc-500 text-sm">
          &copy; 2026 Rankmaps.io. All rights reserved.
        </div>
      </div>

      {/* Right Side: Login Form */}
      <div className="flex items-center justify-center p-8 bg-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-bold text-zinc-900">Welcome back</h2>
            <p className="text-zinc-500 mt-2">
              Enter your credentials to access your dashboard.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-700">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-zinc-700">
                    Password
                  </label>
                  <button
                    type="button"
                    className="text-xs font-bold text-brand-600 hover:text-brand-700"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                  <input
                    name="password"
                    type="password"
                    required
                    placeholder="••••••••"
                    className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-4 focus:ring-brand-50 focus:border-brand-300 outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            {error && (
              <p className="text-red-600 text-sm text-center">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full py-4 rounded-xl text-lg font-bold gap-2"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
              {!loading && <ArrowRight className="w-5 h-5" />}
            </Button>
          </form>

        </motion.div>
      </div>
    </div>
  );
}
