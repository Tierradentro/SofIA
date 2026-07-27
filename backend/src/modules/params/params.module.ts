import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemParam } from './entities/system-param.entity';
import { ParamsService } from './params.service';

@Module({
  imports: [TypeOrmModule.forFeature([SystemParam])],
  providers: [ParamsService],
  exports: [ParamsService],
})
export class ParamsModule {}
