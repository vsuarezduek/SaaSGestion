-- 0020 · «Marcar para pedir»: un producto se puede marcar a mano para que aparezca en la mercadería a pedir (aditiva).
ALTER TABLE productos ADD COLUMN a_pedir boolean NOT NULL DEFAULT false;
