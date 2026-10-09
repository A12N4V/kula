module "vpc" {
  source = "./modules/vpc"
}
resource "aws_instance" "web" {
  ami = lookup(var.amis, "us")
}
variable "amis" {}
