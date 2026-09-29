-- Hosted OTP (otp.com): the gateway makes and checks the code, VOIDEX keeps
-- only its verification id. Additive: older releases keep working.
ALTER TABLE "phone_verifications" ALTER COLUMN "code_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD COLUMN IF NOT EXISTS "provider" text;
--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD COLUMN IF NOT EXISTS "provider_ref" text;
