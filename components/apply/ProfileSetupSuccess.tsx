import { Button } from "@/components/ui/Button"
import { Card, CardBody } from "@/components/ui/Card"

export function ProfileSetupSuccess({ returnTo }: { returnTo?: string }) {
  const target = typeof returnTo === "string" && returnTo.trim() ? returnTo.trim() : "/dashboard/jobs"
  return (
    <Card>
      <CardBody className="pt-6">
        <div className="grid gap-2">
          <div className="text-base font-semibold">Profile ready</div>
          <div className="text-sm text-muted-foreground">You can now apply faster and track everything from your dashboard.</div>
          <div className="mt-3 flex gap-2">
            <a href={target} className="flex-1">
              <Button className="w-full">Continue</Button>
            </a>
            <a href="/jobs" className="flex-1">
              <Button variant="secondary" className="w-full">Browse jobs</Button>
            </a>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

