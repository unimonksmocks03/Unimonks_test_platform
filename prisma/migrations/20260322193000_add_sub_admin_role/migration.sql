DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'Role'
          AND e.enumlabel = 'SUB_ADMIN'
    ) THEN
        ALTER TYPE "Role" ADD VALUE 'SUB_ADMIN';
    END IF;
END $$;
