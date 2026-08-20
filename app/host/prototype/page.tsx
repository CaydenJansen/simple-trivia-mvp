import { notFound } from "next/navigation";
import HostAuthGate from "../../../components/host/HostAuthGate";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <HostAuthGate showDevNavigator />;
}
