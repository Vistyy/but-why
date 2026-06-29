{
  description = "But Why development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      node = pkgs.nodejs_24;
      pnpm = pkgs.pnpm.override { nodejs = node; };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          node
          pnpm
          pkgs.just
        ];
      };
    };
}
