Pod::Spec.new do |s|
  s.name = 'YorunRecorder'
  s.version = '0.1.0'
  s.summary = 'Yorun native background location journal'
  s.license = { :type => 'UNLICENSED' }
  s.homepage = 'https://github.com/Frogrammer-dev'
  s.author = 'YORUN'
  s.source = { :git => 'https://github.com/Frogrammer-dev/YORUN.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/YorunRecorder/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
