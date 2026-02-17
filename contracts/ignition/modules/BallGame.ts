import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("BallGameModule", (m) => {
  const ballGame = m.contract("BallGame");

  return { ballGame };
});
